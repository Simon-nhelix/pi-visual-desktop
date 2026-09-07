import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import * as desktop from '../src/index.ts';

async function fixture(run: (file: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-consent-'));
  try { await run(join(directory, 'settings.json'), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('consent writer: persists both choices without losing unrelated or extension sibling settings', async () => {
  await fixture(async (file, directory) => {
    const original = { theme: 'dark', packages: ['local-package'], mcpServers: { local: { command: 'node' } },
      'pi-visual-desktop': { futureOption: 7, autoEnable: false } };
    await writeFile(file, JSON.stringify(original));
    assert.equal(await desktop.writeAutoEnable(true, () => true, file), true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      ...original, 'pi-visual-desktop': { futureOption: 7, autoEnable: true },
    });
    assert.equal(await desktop.readAutoEnable(file), true);
    await desktop.writeAutoEnable(false, () => true, file);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), original);
    assert.deepEqual(await readdir(directory), ['settings.json']);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  });
});

test('consent writer: creates missing user directory and settings; cancellation leaves no files', async () => {
  await fixture(async (_file, directory) => {
    const file = join(directory, 'new-user', 'settings.json');
    assert.equal(await desktop.writeAutoEnable(true, () => false, file), false);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(await desktop.writeAutoEnable(true, () => true, file), true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { 'pi-visual-desktop': { autoEnable: true } });
  });
});

test('consent writer: refuses malformed JSON and object shapes without exposing or replacing content', async () => {
  await fixture(async (file) => {
    for (const content of ['{ secret-value', 'null', '[]', '42', '{"pi-visual-desktop":null}',
      '{"pi-visual-desktop":[]}', '{"pi-visual-desktop":"secret-value"}']) {
      await writeFile(file, content);
      await assert.rejects(desktop.writeAutoEnable(true, () => true, file), error => {
        assert.match((error as Error).message, /save.*user settings/i);
        assert.doesNotMatch((error as Error).message, /secret-value/);
        return true;
      });
      assert.equal(await readFile(file, 'utf8'), content);
    }
  });
});

test('consent writer: shares Pi settings lock and refuses contention without overwriting', async () => {
  await fixture(async (file) => {
    await writeFile(file, '{"theme":"light"}');
    const release = lockfile.lockSync(file, { realpath: false });
    try {
      await assert.rejects(desktop.writeAutoEnable(true, () => true, file), /save.*user settings/i);
      assert.equal(await readFile(file, 'utf8'), '{"theme":"light"}');
    } finally { release(); }
    assert.equal(await desktop.writeAutoEnable(true, () => true, file), true);
  });
});

test('consent writer: refuses symlink and directory targets without altering destination', async () => {
  await fixture(async (file, directory) => {
    const target = join(directory, 'target.json');
    await writeFile(target, '{"theme":"dark"}');
    await symlink(target, file);
    await assert.rejects(desktop.writeAutoEnable(true, () => true, file), /save.*user settings/i);
    assert.equal(await readFile(target, 'utf8'), '{"theme":"dark"}');
    await rm(file);
    await mkdir(file);
    await assert.rejects(desktop.writeAutoEnable(true, () => true, file), /save.*user settings/i);
  });
});

test('consent writer: queued revocation wins over enable without losing settings', async () => {
  await fixture(async (file) => {
    await writeFile(file, '{"theme":"dark"}');
    await Promise.all([
      desktop.writeAutoEnable(true, () => true, file),
      desktop.writeAutoEnable(false, () => true, file),
    ]);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { theme: 'dark', 'pi-visual-desktop': { autoEnable: false } });
  });
});
