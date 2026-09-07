import { type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readAutoEnable, writeAutoEnable } from './settings.ts';
import { DesktopController } from './controller.ts';
import { actionSchema, observeSchema } from './protocol.ts';
import { HelperTransport } from './transport.ts';
export { readAutoEnable, writeAutoEnable } from './settings.ts';

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

export function registerDesktop(pi: ExtensionAPI, controller: DesktopController, platform = process.platform,
  loadAutoEnable: () => Promise<boolean> = readAutoEnable,
  saveAutoEnable: (value: boolean, isCurrent: () => boolean) => Promise<boolean> = writeAutoEnable) {
  let epoch = 0;
  let autoEnable = false;
  let unavailable = 'First approval needed: /desktop on (remembered for future local Pi sessions).';
  let saving: Promise<unknown> = Promise.resolve();
  const save = (value: boolean, isCurrent: () => boolean) => {
    const next = saving.then(() => isCurrent() ? saveAutoEnable(value, isCurrent) : false);
    saving = next.catch(() => {});
    return next;
  };
  const reset = async () => { epoch++; await controller.disable(); };
  const vision = (ctx: ExtensionContext) => ctx.model?.input.includes('image') === true;
  const status = (ctx: ExtensionContext) => {
    if (ctx.mode !== 'tui' || !ctx.hasUI) return;
    ctx.ui.setStatus('desktop', controller.isEnabled
      ? (vision(ctx) ? 'desktop: on' : 'desktop: vision model required') : 'desktop: off');
  };
  const ready = (ctx: ExtensionContext) => {
    status(ctx);
    if (!vision(ctx)) ctx.ui.notify('Desktop requires a vision-capable model; select one with /model before desktop work.', 'warning');
  };
  const requireEnabled = () => {
    if (!controller.isEnabled) throw new Error(`Desktop is off. ${unavailable}`);
  };
  pi.on('session_start', async (_event, ctx) => {
    const before = ++epoch;
    autoEnable = false;
    await controller.disable();
    if (before !== epoch || platform !== 'darwin' || ctx.mode !== 'tui' || !ctx.hasUI) return;
    try {
      const configured = await loadAutoEnable();
      if (before !== epoch) return;
      autoEnable = configured === true;
      if (!autoEnable) {
        unavailable = 'First approval needed: /desktop on. Approve once to remember this Mac for future local Pi sessions.';
        status(ctx);
        ctx.ui.notify(`Desktop off. ${unavailable}`, 'info');
        return;
      }
      // Only starts the local helper and checks health/ownership; no capture or input.
      await controller.enable();
      if (before !== epoch) return;
      unavailable = 'Control stopped or disconnected; inspect the desktop, then /desktop on to reconnect. Never retry unknown input.';
      ctx.ui.notify('Desktop automatically enabled by your saved consent. Do not use this desktop concurrently. /desktop off to pause; /desktop forget to revoke.', 'info');
      ready(ctx);
    } catch (error) {
      if (before !== epoch) return;
      unavailable = `${error instanceof Error ? error.message : 'Local setup failed.'} No automatic retry; use /desktop on after resolving it.`;
      status(ctx);
      ctx.ui.notify(`Desktop auto-enable unavailable: ${unavailable}`, 'warning');
    }
  });
  pi.on('session_shutdown', async (_event, ctx) => { await reset(); if (ctx.mode === 'tui' && ctx.hasUI) ctx.ui.setStatus('desktop', undefined); });
  pi.on('model_select', async (_event, ctx) => { status(ctx); });
  pi.on('before_agent_start', async (_event, ctx) => {
    if (platform !== 'darwin' || ctx.mode !== 'tui' || !ctx.hasUI) return;
    const availability = !controller.isEnabled ? `off: ${unavailable}`
      : !vision(ctx) ? 'blocked: select a vision-capable model before desktop work.'
      : 'available. Use desktop_observe for fresh pixels before acting; no additional enable approval is needed.';
    return { message: { customType: 'desktop-availability', display: false,
      content: `Desktop ${availability} This is control status, not evidence of screen contents or task success. No capture/input performed by this status check.` } };
  });
  pi.registerCommand('desktop', {
    description: 'Local desktop: on (remember) | off (pause) | forget (revoke) | status',
    handler: async (args, ctx) => {
      const command = args.trim();
      let commandEpoch: number | undefined;
      try {
        if (command === 'off') {
          unavailable = 'Paused by user. /desktop on to resume; /desktop forget to revoke saved consent.';
          await reset(); status(ctx);
          ctx.ui.notify('Desktop off for this session. Saved consent unchanged; /desktop forget to disable future auto-start.', 'info');
          return;
        }
        if (command === 'status' || command === '') {
          status(ctx);
          ctx.ui.notify(`${await versionStatus()}\ndesktop=${controller.isEnabled ? 'on' : 'off'}; autoEnable=${autoEnable} (last read/saved user consent); ${controller.isEnabled ? (vision(ctx) ? 'health/ownership checked; task success not verified' : 'vision-capable model required') : unavailable} macOS 14+ only. Diagnostics: npm run health (no capture/input).`, 'info');
          return;
        }
        if (command !== 'on' && command !== 'forget') throw new Error('Usage: /desktop on|off|forget|status');
        if (platform !== 'darwin') throw new Error('Unsupported OS: only macOS 14+ is implemented.');
        if (ctx.mode !== 'tui' || !ctx.hasUI) throw new Error('Manage consent only in a local interactive Pi TUI; RPC/headless cannot enable desktop.');
        if (command === 'forget') {
          unavailable = 'Consent revoked for this session. /desktop on to approve again.';
          await reset(); status(ctx);
          try {
            // Revocation must finish even if shutdown follows. Serialize behind any pending save.
            await save(false, () => true);
            autoEnable = false;
            ctx.ui.notify('Desktop off. Saved consent revoked; future sessions stay off until /desktop on approval.', 'info');
          } catch {
            ctx.ui.notify('Desktop off, but consent may still be saved. Set pi-visual-desktop.autoEnable=false in user settings before restarting Pi; /desktop forget can retry the settings write.', 'error');
          }
          return;
        }
        if (!ctx.isIdle()) throw new Error('Wait for the current Pi turn to finish before enabling desktop.');
        const before = commandEpoch = ++epoch;
        const current = () => before === epoch;
        const remembered = await loadAutoEnable();
        if (!current()) return;
        autoEnable = remembered === true;
        if (!autoEnable) {
          const confirmed = await ctx.ui.confirm('Enable and remember foreground desktop control?',
            'Allow this Mac to see the whole main display and inject real input now and in future local Pi TUI sessions. Consent is saved in user settings. Screenshots enter the normal Pi model/session path. Do not use this desktop concurrently. /desktop off pauses; /desktop forget revokes. Continue?', { timeout: 30_000 });
          if (!confirmed || !current()) return;
          try {
            const saved = await save(true, current);
            if (!saved || !current()) return;
            autoEnable = true;
          } catch {
            if (!current()) return;
            ctx.ui.notify('Desktop consent not saved; permission applies to this session only. Check user settings (valid JSON, writable, not a symlink or locked). Use /desktop on again to save after fixing it.', 'warning');
          }
        }
        if (!current()) return;
        if (!controller.isEnabled) await controller.enable();
        if (!current()) return;
        unavailable = 'Control stopped or disconnected; inspect the desktop, then /desktop on to reconnect. Never retry unknown input.';
        ctx.ui.notify(`Desktop on${autoEnable ? '; consent remembered for future local Pi sessions' : ' for this session only'}. Do not use this desktop concurrently. /desktop off to pause; /desktop forget to revoke.`, 'info');
        ready(ctx);
      } catch (error) {
        if (commandEpoch !== undefined && commandEpoch !== epoch) return;
        if (!controller.isEnabled) unavailable = `${error instanceof Error ? error.message : 'Desktop command failed.'} /desktop on after resolving it.`;
        status(ctx);
        ctx.ui.notify(error instanceof Error ? error.message : 'Desktop command failed.', 'error');
      }
    },
  });
  pi.registerTool({
    name: 'desktop_observe', label: 'Desktop observe',
    description: 'Observe a NEW main-display PNG (edge <=1280, never upscaled). Optional zoom:{ref,x,y,width,height} selects pixel edges in the latest image; nested zoom supported. Returned image coordinates map directly to input. {} resets full screen. Optional waitMs:0..2000 is an explicit cancellable wait before capture. Returns timestamp, dimensions, one-use ref expiring after 120s. Requires enabled desktop (user autoEnable setting or /desktop on). No AX/DOM/OCR.',
    parameters: observeSchema,
    async execute(_id, params, signal, _update, ctx) {
      if (ctx.mode !== 'tui' || !ctx.model?.input.includes('image')) throw new Error('Desktop requires local TUI and a vision-capable Pi model.');
      requireEnabled();
      try { return await controller.observe(params, signal); }
      catch (error) {
        if (!controller.isEnabled) unavailable = error instanceof Error ? error.message : 'Observation failed; inspect desktop before reconnecting.';
        throw error;
      } finally { status(ctx); }
    },
  });
  pi.registerTool({
    name: 'desktop_act', label: 'Desktop act',
    description: 'One foreground primitive then full-screen screenshot. Optional settleMs:0..2000 controls post-input wait (default250); use longer for known UI transitions, not input retries. Dispatched is NOT verified success. Use latest ref and integer pixels in that exact image (top-left 0,0). move is one no-button hover event with x,y only. Mouse actions require x,y; drag also toX,toY; scroll also dx,dy (pixels, positive right/down). type requires literal text, no clipboard. key requires a named physical key (e.g. return, tab, escape, left, a) and explicit modifiers array (may be empty); use type for literal Unicode, not key sequences. Only action-specific fields allowed. Never retry unknown outcomes.',
    parameters: actionSchema,
    async execute(_id, params, signal, _update, ctx) {
      if (ctx.mode !== 'tui' || !ctx.model?.input.includes('image')) throw new Error('Desktop requires local TUI and a vision-capable Pi model.');
      requireEnabled();
      try { return await controller.act(params, signal); }
      catch (error) {
        if (!controller.isEnabled) unavailable = error instanceof Error ? error.message : 'Input outcome unknown; do not retry. Inspect desktop before reconnecting.';
        throw error;
      } finally { status(ctx); }
    },
  });
}
export default function desktop(pi: ExtensionAPI) {
  registerDesktop(pi, new DesktopController(() => new HelperTransport(executable)));
}
