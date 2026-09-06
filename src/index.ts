import { getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopController } from './controller.ts';
import { actionSchema } from './protocol.ts';
import { HelperTransport } from './transport.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = fileURLToPath(new URL('../build/desktop-helper', import.meta.url));
export async function versionStatus() {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const run = promisify(execFile);
  try {
    const opts = { cwd: root, timeout: 2000, maxBuffer: 64_000 };
    const revision = (await run('git', ['rev-parse', '--short=12', 'HEAD'], opts)).stdout.trim();
    const dirty = (await run('git', ['status', '--porcelain', '--untracked-files=normal'], opts)).stdout.length > 0;
    return `${pkg.name} ${pkg.version} git=${revision} ${dirty ? 'dirty' : 'clean'}`;
  } catch { return `${pkg.name} ${pkg.version} git=unavailable`; }
}

/** Only user settings can persist consent. Never read cwd/project settings for auto-enable. */
export async function readAutoEnable(settingsPath = join(getAgentDir(), 'settings.json')) {
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    return settings?.['pi-visual-desktop']?.autoEnable === true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('Cannot read desktop autoEnable from user settings; desktop stays off.');
  }
}

export function registerDesktop(pi: ExtensionAPI, controller: DesktopController, platform = process.platform,
  loadAutoEnable: () => Promise<boolean> = readAutoEnable) {
  let epoch = 0;
  let autoEnable = false;
  const reset = async () => { epoch++; await controller.disable(); };
  pi.on('session_start', async (_event, ctx) => {
    const before = ++epoch;
    autoEnable = false;
    await controller.disable();
    if (before !== epoch || platform !== 'darwin' || ctx.mode !== 'tui' || !ctx.hasUI) return;
    try {
      const configured = await loadAutoEnable();
      if (before !== epoch) return;
      autoEnable = configured === true;
      if (!autoEnable) return;
      // Only starts the local helper and checks health/ownership; no capture or input.
      await controller.enable();
      if (before !== epoch) return;
      ctx.ui.notify('Desktop automatically enabled by your user settings. Do not use this desktop concurrently. /desktop off to stop.', 'warning');
    } catch (error) {
      if (before !== epoch) return;
      ctx.ui.notify(`Desktop auto-enable unavailable: ${error instanceof Error ? error.message : 'Local setup failed.'} No automatic retry; use /desktop on after resolving it.`, 'warning');
    }
  });
  pi.on('session_shutdown', reset);
  pi.registerCommand('desktop', {
    description: 'Local desktop: on | off | status (includes version/revision)',
    handler: async (args, ctx) => {
      const command = args.trim();
      try {
        if (command === 'off') { await reset(); ctx.ui.notify('Desktop off.', 'info'); return; }
        if (command === 'status' || command === '') {
          ctx.ui.notify(`${await versionStatus()}\ndesktop=${controller.isEnabled ? 'on' : 'off'}; autoEnable=${autoEnable} (user setting applied at session start); macOS 14+ only. Diagnostics: npm run health (no capture/input).`, 'info');
          return;
        }
        if (command !== 'on') throw new Error('Usage: /desktop on|off|status');
        if (platform !== 'darwin') throw new Error('Unsupported OS: only macOS 14+ is implemented.');
        if (ctx.mode !== 'tui' || !ctx.hasUI) throw new Error('Enable only in a local interactive Pi TUI; RPC/headless cannot enable desktop.');
        if (controller.isEnabled) { ctx.ui.notify('Desktop is already on. /desktop off to stop.', 'info'); return; }
        if (!ctx.isIdle()) throw new Error('Wait for the current Pi turn to finish before enabling desktop.');
        const before = epoch;
        const confirmed = await ctx.ui.confirm('Enable foreground desktop control?',
          'This session can see the whole main display and inject real input. Do not use this desktop concurrently. Screenshots enter the normal Pi model/session path. Continue?', { timeout: 30_000 });
        if (!confirmed || before !== epoch) return;
        await controller.enable();
        ctx.ui.notify('Desktop on for this session. Do not use the same desktop concurrently. /desktop off to stop.', 'warning');
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : 'Desktop command failed.', 'error'); }
    },
  });
  pi.registerTool({
    name: 'desktop_observe', label: 'Desktop observe',
    description: 'Observe whole main display (PNG, longest edge <=1280). Returns timestamp, dimensions, one-use ref expiring after 120s. Requires enabled desktop (user autoEnable setting or /desktop on). No AX/DOM/OCR.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      if (ctx.mode !== 'tui' || !ctx.model?.input.includes('image')) throw new Error('Desktop requires local TUI and a vision-capable Pi model.');
      if (Object.keys(params).length) throw new Error('desktop_observe accepts no arguments.');
      return controller.observe(signal);
    },
  });
  pi.registerTool({
    name: 'desktop_act', label: 'Desktop act',
    description: 'One foreground primitive then 250ms settle and screenshot; dispatched is NOT verified success. Use latest ref and integer pixels in that exact image (top-left 0,0). Mouse actions require x,y; drag also toX,toY; scroll also dx,dy (pixels, positive right/down). type requires literal text, no clipboard. key requires a named physical key (e.g. return, tab, escape, left, a) and explicit modifiers array (may be empty); use type for literal Unicode, not key sequences. Only action-specific fields allowed. Never retry unknown outcomes.',
    parameters: actionSchema,
    async execute(_id, params, signal, _update, ctx) {
      if (ctx.mode !== 'tui' || !ctx.model?.input.includes('image')) throw new Error('Desktop requires local TUI and a vision-capable Pi model.');
      return controller.act(params, signal);
    },
  });
}
export default function desktop(pi: ExtensionAPI) {
  registerDesktop(pi, new DesktopController(() => new HelperTransport(executable)));
}
