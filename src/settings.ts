import { getAgentDir, withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';

const settingsFile = () => join(getAgentDir(), 'settings.json');

/** Only user settings can persist consent. Never read cwd/project settings for auto-enable. */
export async function readAutoEnable(settingsPath = settingsFile()) {
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    return settings?.['pi-visual-desktop']?.autoEnable === true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('Cannot read desktop autoEnable from user settings; desktop stays off.');
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Local command only. Merge under Pi's settings lock; never rewrite corrupt settings. */
export async function writeAutoEnable(value: boolean, isCurrent = () => true, settingsPath = settingsFile()): Promise<boolean> {
  try {
    return await withFileMutationQueue(settingsPath, async () => {
      if (!isCurrent()) return false;
      mkdirSync(dirname(settingsPath), { recursive: true });
      // Same cross-process lock as Pi's FileSettingsStorage; no wait or input retry.
      const release = lockfile.lockSync(settingsPath, { realpath: false, retries: 0 });
      let temporary: string | undefined;
      try {
        if (!isCurrent()) return false;
        let settings: unknown = {};
        try {
          if (!lstatSync(settingsPath).isFile()) throw new Error('Unsafe settings target.');
          settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (!object(settings)) throw new Error('Invalid settings object.');
        const desktop = settings['pi-visual-desktop'];
        if (desktop !== undefined && !object(desktop)) throw new Error('Invalid desktop settings object.');
        settings['pi-visual-desktop'] = { ...(desktop as Record<string, unknown> | undefined), autoEnable: value };
        temporary = join(dirname(settingsPath), `.desktop-settings-${randomUUID()}.tmp`);
        writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        // Synchronous guarded mutation: off/shutdown cannot interleave before this commit.
        renameSync(temporary, settingsPath);
        temporary = undefined;
        return true;
      } finally {
        try { if (temporary) rmSync(temporary, { force: true }); }
        finally { release(); }
      }
    });
  } catch {
    // JSON parser/filesystem errors may contain private configuration; do not forward them.
    throw new Error('Cannot save desktop consent to user settings. Check settings.json is a valid object, writable, not a symlink, and not locked by another Pi.');
  }
}
