import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { wrapRegisteredTool, type ExtensionAPI, type ExtensionCommandContext, type ExtensionRunner,
  type RegisteredCommand, type RegisteredTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { readAutoEnable, writeAutoEnable, registerDesktop, versionStatus } from '../src/index.ts';
import { DesktopController } from '../src/controller.ts';
import { MockTransport, NOW, PNG, deferred } from './fixtures.ts';

function harness(platform: NodeJS.Platform = 'darwin', loadAutoEnable?: () => Promise<boolean>,
  saveAutoEnable?: (value: boolean, isCurrent: () => boolean) => Promise<boolean>) {
  let remembered = false;
  const saves: boolean[] = [];
  const save = saveAutoEnable ?? (async (value: boolean, isCurrent: () => boolean) => {
    if (!isCurrent()) return false;
    remembered = value; saves.push(value); return true;
  });
  const transport = new MockTransport();
  const controller = new DesktopController(() => transport, () => NOW);
  const tools = new Map<string, ToolDefinition>();
  const events = new Map<string, () => Promise<unknown>>();
  let command!: RegisteredCommand;
  const notifications: string[] = [], prompts: string[] = [];
  const statuses = new Map<string, string | undefined>();
  let confirmations = 0, approved = true;
  const ctx = { mode: 'tui', hasUI: true, model: { input: ['text', 'image'] }, isIdle: () => true,
    ui: { notify: (message: string) => notifications.push(message),
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      confirm: async (title: string, message: string) => { confirmations++; prompts.push(`${title}\n${message}`); return approved; } },
  } as unknown as ExtensionCommandContext;
  const pi = { registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerCommand: (_name: string, definition: RegisteredCommand) => { command = definition; },
    on: (name: string, handler: (event: unknown, context: ExtensionCommandContext) => Promise<unknown>) =>
      events.set(name, () => handler({ reason: 'startup' }, ctx)),
  } as unknown as ExtensionAPI;
  registerDesktop(pi, controller, platform, loadAutoEnable ?? (async () => remembered), save);
  return { transport, controller, tools, events, ctx, notifications, prompts, statuses, saves,
    approve: (value: boolean) => { approved = value; }, confirmations: () => confirmations,
    command: (arg: string) => command.handler(arg, ctx) };
}

test('Pi adapter: two tools only, stock TUI confirmation, never grant from tools or headless', async () => {
  for (const mode of ['rpc', 'json', 'print'] as const) {
    const h = harness(); h.ctx.mode = mode;
    await h.command('on'); assert.equal(h.controller.isEnabled, false); assert.equal(h.confirmations(), 0);
  }
  const unsupported = harness('linux'); await unsupported.command('on'); assert.equal(unsupported.confirmations(), 0);
  const h = harness(); assert.deepEqual([...h.tools.keys()], ['desktop_observe', 'desktop_act']);
  await assert.rejects(h.tools.get('desktop_observe')!.execute('id', {}, undefined, undefined, h.ctx), /off/);
  assert.equal(h.confirmations(), 0); assert.equal(h.transport.calls.length, 0);
  h.approve(false); await h.command('on'); assert.equal(h.controller.isEnabled, false);
  h.approve(true); await h.command('on'); assert.equal(h.controller.isEnabled, true);
  await h.command('off'); assert.equal(h.controller.isEnabled, false);
});

test('Pi adapter: real Pi registered-tool wrapper preserves actual image blocks and throws failures', async () => {
  const h = harness(); await h.command('on');
  const definition = h.tools.get('desktop_observe')!;
  const runner = { createContext: () => h.ctx, getActiveTools: () => [...h.tools.keys()] } as unknown as ExtensionRunner;
  const tool = wrapRegisteredTool({ definition, sourceInfo: { source: 'extension', path: 'test' } } as RegisteredTool, runner);
  const result = await tool.execute('id', {});
  assert.deepEqual(result.content[1], { type: 'image', mimeType: 'image/png', data: PNG });
  assert.equal('isError' in result, false);
  assert.equal(JSON.stringify(result.details).includes(PNG), false);
  await h.command('off');
  await assert.rejects(tool.execute('id', {}), /off/); // Pi marks thrown execute failures as isError, not returned objects.
  assert.equal(h.confirmations(), 1);
});

test('Pi adapter: revoked consent on session start resets control; stale confirmation cannot enable', async () => {
  const h = harness('darwin', async () => false); await h.command('on'); await h.events.get('session_start')!();
  assert.equal(h.controller.isEnabled, false);
  await h.command('on'); await h.events.get('session_shutdown')!(); assert.equal(h.controller.isEnabled, false);
  const confirmation = deferred<boolean>(), entered = deferred<void>();
  h.ctx.ui.confirm = () => { entered.resolve(); return confirmation.promise; };
  const savedBefore = h.saves.length;
  const command = h.command('on');
  await entered.promise;
  await h.events.get('session_shutdown')!(); confirmation.resolve(true); await command;
  assert.equal(h.controller.isEnabled, false);
  assert.equal(h.saves.length, savedBefore);
});

test('Pi adapter: non-vision model and RPC tools cannot observe even after opt-in', async () => {
  const h = harness(); await h.command('on');
  h.ctx.model = { input: ['text'] } as typeof h.ctx.model;
  await assert.rejects(h.tools.get('desktop_observe')!.execute('id', {}, undefined, undefined, h.ctx), /vision/);
  h.ctx.mode = 'rpc';
  await assert.rejects(h.tools.get('desktop_act')!.execute('id', {}, undefined, undefined, h.ctx), /TUI/);
  assert.equal(h.transport.calls.length, 1);
});

test('Pi adapter: status reports version and git revision/dirty state without capture', async () => {
  const h = harness(); await h.command('status');
  assert.match(await versionStatus(), /pi-visual-desktop 0\.2\.0 git=(?:[a-f0-9]{12} (?:clean|dirty)|unavailable)/);
  assert.equal(h.transport.calls.length, 0);
});

test('User config: tilde override reads the real user directory, never project lookalikes', async () => {
  const user = await mkdtemp(join(homedir(), '.pi-desktop-tilde-test-'));
  const project = await mkdtemp(join(tmpdir(), 'pi-desktop-project-test-'));
  const lookalike = join(project, '~', basename(user));
  const moduleUrl = new URL('../src/index.ts', import.meta.url).href;
  const readDefault = () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { readAutoEnable } from ${JSON.stringify(moduleUrl)}; console.log(await readAutoEnable());`], {
      cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: `~/${basename(user)}` },
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    return result.stdout.trim();
  };
  const setting = (autoEnable: boolean) => JSON.stringify({ 'pi-visual-desktop': { autoEnable } });
  try {
    await mkdir(lookalike, { recursive: true });
    await writeFile(join(user, 'settings.json'), setting(false));
    await writeFile(join(lookalike, 'settings.json'), setting(true));
    assert.equal(readDefault(), 'false');
    await writeFile(join(user, 'settings.json'), setting(true));
    await writeFile(join(lookalike, 'settings.json'), setting(false));
    assert.equal(readDefault(), 'true');
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(user, { recursive: true, force: true });
  }
});

// Automatic activation is prior user consent in global settings, not consent granted by tools.
test('Pi adapter: explicit autoEnable starts health only without confirmation; off remains off', async () => {
  const h = harness('darwin', async () => true);
  await h.events.get('session_start')!();
  assert.equal(h.controller.isEnabled, true);
  assert.equal(h.confirmations(), 0);
  assert.deepEqual(h.transport.calls, [{ op: 'health' }]);
  assert.match(h.notifications[0], /automatically enabled/);
  await h.command('on');
  assert.equal(h.confirmations(), 0);
  assert.equal(h.transport.calls.length, 1);
  await h.command('status');
  assert.match(h.notifications.at(-1)!, /autoEnable=true/);
  await h.command('off');
  await assert.rejects(h.tools.get('desktop_observe')!.execute('id', {}, undefined, undefined, h.ctx), /off/);
  assert.equal(h.controller.isEnabled, false);
  assert.equal(h.transport.calls.length, 1);
});

test('Pi adapter: autoEnable never starts helper in non-TUI or unsupported contexts', async () => {
  for (const mode of ['rpc', 'json', 'print'] as const) {
    const h = harness('darwin', async () => { throw new Error('Should not read configuration'); });
    h.ctx.mode = mode;
    await h.events.get('session_start')!();
    assert.equal(h.transport.calls.length, 0);
    assert.equal(h.notifications.length, 0);
  }
  for (const platform of ['win32', 'linux'] as const) {
    const h = harness(platform, async () => true);
    await h.events.get('session_start')!();
    assert.equal(h.transport.calls.length, 0);
  }
});

test('Pi adapter: missing consent stays off; config/health/ownership failures never retry', async () => {
  const manual = harness(); await manual.events.get('session_start')!();
  assert.equal(manual.controller.isEnabled, false);
  assert.equal(manual.transport.calls.length, 0);
  const broken = harness('darwin', async () => { throw new Error('Cannot read desktop settings'); });
  await broken.events.get('session_start')!();
  assert.equal(broken.controller.isEnabled, false);
  assert.equal(broken.transport.calls.length, 0);
  assert.match(broken.notifications[0], /auto-enable unavailable/);
  for (const reply of [
    { ok: false, error: 'Another session holds the desktop lock.' },
    { ok: true, health: { screenRecording: false, accessibility: true, secureInput: false } },
    { ok: true, health: { screenRecording: true, accessibility: true, secureInput: true } },
  ]) {
    const h = harness('darwin', async () => true);
    h.transport.handle = async () => reply;
    await h.events.get('session_start')!();
    assert.equal(h.controller.isEnabled, false);
    assert.equal(h.transport.closed, true);
    assert.equal(h.transport.calls.length, 1);
    assert.match(h.notifications[0], /No automatic retry/);
    await assert.rejects(h.tools.get('desktop_observe')!.execute('id', {}, undefined, undefined, h.ctx), /off/);
    assert.equal(h.transport.calls.length, 1);
  }
});

test('Pi adapter: off or shutdown during settings read cannot revive auto-enable', async () => {
  for (const stop of ['off', 'shutdown']) {
    const entered = deferred<void>(), config = deferred<boolean>();
    const h = harness('darwin', () => { entered.resolve(); return config.promise; });
    const start = h.events.get('session_start')!();
    await entered.promise;
    if (stop === 'off') await h.command('off'); else await h.events.get('session_shutdown')!();
    config.resolve(true); await start;
    assert.equal(h.controller.isEnabled, false);
    assert.equal(h.transport.calls.length, 0);
    assert.equal(h.notifications.some(n => n.includes('automatically enabled')), false);
  }
});

test('Pi adapter: shutdown during automatic health check cannot grant control', async () => {
  const entered = deferred<void>(), health = deferred<Awaited<ReturnType<MockTransport['request']>>>();
  const h = harness('darwin', async () => true);
  h.transport.handle = () => { entered.resolve(); return health.promise; };
  const start = h.events.get('session_start')!();
  await entered.promise;
  const stop = h.events.get('session_shutdown')!();
  health.resolve({ ok: true, health: { screenRecording: true, accessibility: true, secureInput: false } });
  await Promise.all([start, stop]);
  assert.equal(h.controller.isEnabled, false);
  assert.equal(h.transport.closed, true);
  assert.equal(h.notifications.length, 0);
});

test('User config: only literal true opts in; missing or malformed settings fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-desktop-config-test-'));
  const file = join(directory, 'settings.json');
  try {
    assert.equal(await readAutoEnable(file), false);
    for (const value of [false, 'true', 1, null, undefined]) {
      await writeFile(file, JSON.stringify({ 'pi-visual-desktop': { autoEnable: value } }));
      assert.equal(await readAutoEnable(file), false);
    }
    await writeFile(file, JSON.stringify({ 'pi-visual-desktop': { autoEnable: true } }));
    assert.equal(await readAutoEnable(file), true);
    await writeFile(file, '{ invalid settings secret-value');
    await assert.rejects(readAutoEnable(file), error => {
      assert.match((error as Error).message, /stays off/);
      assert.equal((error as Error).message.includes('secret-value'), false);
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Pi adapter: observe zoom/wait and move traverse real tool wrapper with image blocks', async () => {
  const h = harness(); await h.command('on');
  const runner = { createContext: () => h.ctx, getActiveTools: () => [...h.tools.keys()] } as unknown as ExtensionRunner;
  const wrap = (name: string) => wrapRegisteredTool({ definition: h.tools.get(name)!, sourceInfo: { source: 'extension', path: 'test' } } as RegisteredTool, runner);
  const observe = wrap('desktop_observe'), act = wrap('desktop_act');
  const first = await observe.execute('full', {});
  const zoom = { ref: (first.details as { ref: string }).ref, x: 0, y: 0, width: 1, height: 1 };
  const cropped = await observe.execute('zoom', { zoom, waitMs: 1 });
  assert.deepEqual(h.transport.calls.at(-1), { op: 'observe', zoom });
  assert.deepEqual(cropped.content[1], { type: 'image', mimeType: 'image/png', data: PNG });
  const moved = await act.execute('move', { ref: (cropped.details as { ref: string }).ref, action: 'move', x: 0, y: 0 });
  assert.deepEqual(moved.content[1], { type: 'image', mimeType: 'image/png', data: PNG });
  assert.equal(h.transport.calls.at(-1)!.action, 'move');
  await assert.rejects(observe.execute('invalid', { waitMs: 2001 }));
  await h.command('off');
});


test('Pi adapter: model receives current availability before work without new health/capture/input', async () => {
  const h = harness('darwin', async () => true);
  const preTurn = async () => {
    const result = await h.events.get('before_agent_start')?.() as { message?: { content: string; display: boolean } } | undefined;
    assert.ok(result?.message, 'availability must reach the model, not just the footer');
    assert.equal(result.message.display, false);
    return result.message.content;
  };
  await h.events.get('session_start')!();
  assert.match(await preTurn(), /available.*desktop_observe/s);
  assert.deepEqual(h.transport.calls, [{ op: 'health' }]);
  await h.command('off');
  assert.match(await preTurn(), /off.*Paused by user/s);
  assert.deepEqual(h.transport.calls, [{ op: 'health' }]);
  await h.command('on');
  const observed = await h.tools.get('desktop_observe')!.execute('id', {}, undefined, undefined, h.ctx);
  h.transport.handle = async () => { throw new Error('input timeout'); };
  await assert.rejects(h.tools.get('desktop_act')!.execute('id', { ref: (observed.details as {ref: string}).ref,
    action: 'click', x: 0, y: 0 }, undefined, undefined, h.ctx), /outcome unknown/);
  assert.match(await preTurn(), /outcome unknown.*Do NOT retry/s);
  const blocked = harness(); blocked.ctx.mode = 'rpc';
  assert.equal(await blocked.events.get('before_agent_start')?.(), undefined);
});

test('Pi adapter: first approval explains persistence and fresh adapter restores saved consent health-only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-adapter-consent-'));
  const file = join(directory, 'settings.json');
  try {
    await writeFile(file, '{"theme":"dark"}');
    const load = () => readAutoEnable(file);
    const save = (value: boolean, current: () => boolean) => writeAutoEnable(value, current, file);
    const first = harness('darwin', load, save);
    await first.command('on');
    assert.equal(await readAutoEnable(file), true);
    assert.equal(first.controller.isEnabled, true);
    assert.match(first.prompts[0], /future.*local.*TUI/i);
    assert.match(first.prompts[0], /forget/);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).theme, 'dark');
    await first.events.get('session_shutdown')!();
    const next = harness('darwin', load, save);
    await next.events.get('session_start')!();
    assert.equal(next.controller.isEnabled, true);
    assert.equal(next.confirmations(), 0);
    assert.deepEqual(next.transport.calls, [{ op: 'health' }]);
    await next.command('off');
    await next.command('on');
    assert.equal(next.controller.isEnabled, true);
    assert.equal(next.confirmations(), 0);
    await next.command('forget');
    assert.equal(next.controller.isEnabled, false);
    assert.equal(await readAutoEnable(file), false);
    const revoked = harness('darwin', load, save);
    await revoked.events.get('session_start')!();
    assert.equal(revoked.controller.isEnabled, false);
    assert.equal(revoked.transport.calls.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Pi adapter: cancel/busy/headless never persist or start health', async () => {
  const cancelled = harness(); cancelled.approve(false);
  await cancelled.command('on');
  assert.deepEqual(cancelled.saves, []);
  assert.deepEqual(cancelled.transport.calls, []);
  const busy = harness(); busy.ctx.isIdle = () => false;
  await busy.command('on');
  assert.deepEqual(busy.saves, []);
  assert.equal(busy.confirmations(), 0);
  for (const mode of ['rpc', 'print', 'json'] as const) {
    const h = harness(); h.ctx.mode = mode;
    await h.command('on'); await h.command('forget');
    assert.deepEqual(h.saves, []);
    assert.deepEqual(h.transport.calls, []);
  }
});

test('Pi adapter: failed persistence is explicit session-only use, not a claim of remembered consent', async () => {
  const h = harness('darwin', async () => false, async () => { throw new Error('disk failure'); });
  await h.command('on');
  assert.equal(h.controller.isEnabled, true);
  assert.match(h.notifications.join(' '), /not saved.*session only/i);
  await h.command('status');
  assert.match(h.notifications.at(-1)!, /autoEnable=false/);
  await h.events.get('session_start')!();
  assert.equal(h.controller.isEnabled, false);
});

test('Pi adapter: shutdown during manual health does not publish stale errors or status', async () => {
  const entered = deferred<void>(), health = deferred<Awaited<ReturnType<MockTransport['request']>>>();
  const h = harness('darwin', async () => true);
  h.transport.handle = () => { entered.resolve(); return health.promise; };
  const enabling = h.command('on'); await entered.promise;
  const stopping = h.events.get('session_shutdown')!();
  health.resolve({ ok: true, health: { screenRecording: true, accessibility: true, secureInput: false } });
  await Promise.all([enabling, stopping]);
  assert.equal(h.controller.isEnabled, false);
  assert.deepEqual(h.notifications, []);
  assert.equal(h.statuses.get('desktop'), undefined);
});

test('Pi adapter: first approval is remembered even when health is temporarily blocked', async () => {
  const h = harness();
  h.transport.handle = async () => ({ ok: true, health: { screenRecording: true, accessibility: true, secureInput: true } });
  await h.command('on');
  assert.deepEqual(h.saves, [true]);
  assert.equal(h.controller.isEnabled, false);
  assert.match(h.notifications.join(' '), /Secure Input/);
});

test('Pi adapter: off/shutdown while consent save waits cannot commit or enable', async () => {
  for (const stop of ['off', 'shutdown']) {
    const entered = deferred<void>(), resume = deferred<void>();
    let persisted = false;
    const h = harness('darwin', async () => false, async (value, current) => {
      entered.resolve(); await resume.promise;
      if (!current()) return false;
      persisted = value; return true;
    });
    const enabling = h.command('on');
    await entered.promise;
    if (stop === 'off') await h.command('off'); else await h.events.get('session_shutdown')!();
    resume.resolve(); await enabling;
    assert.equal(persisted, false);
    assert.equal(h.controller.isEnabled, false);
    assert.equal(h.transport.calls.length, 0);
  }
});

test('Pi adapter: forget orders revocation after an in-flight save and stale on cannot re-enable', async () => {
  const entered = deferred<void>(), resume = deferred<void>();
  let persisted = false;
  const h = harness('darwin', async () => persisted, async (value, current) => {
    if (value) { entered.resolve(); await resume.promise; }
    if (!current()) return false;
    persisted = value; return true;
  });
  const enabling = h.command('on'); await entered.promise;
  const forgetting = h.command('forget');
  resume.resolve(); await Promise.all([enabling, forgetting]);
  assert.equal(persisted, false);
  assert.equal(h.controller.isEnabled, false);
  assert.equal(h.transport.calls.length, 0);
});

test('Pi adapter: failed forget stops immediately and warns consent may still be saved', async () => {
  const h = harness('darwin', async () => true, async () => { throw new Error('disk failure'); });
  await h.events.get('session_start')!();
  await h.command('forget');
  assert.equal(h.controller.isEnabled, false);
  assert.match(h.notifications.at(-1)!, /may still.*saved/i);
});

test('Pi adapter: startup gives availability before work; non-vision model never appears ready', async () => {
  const missing = harness(); await missing.events.get('session_start')!();
  assert.match(missing.notifications.join(' '), /first.*approval|approve.*once/i);
  assert.match(missing.statuses.get('desktop')!, /off/i);
  assert.equal(missing.confirmations(), 0);
  const blocked = harness('darwin', async () => true);
  blocked.transport.handle = async () => ({ ok: false, error: 'Another session holds the desktop lock.' });
  await blocked.events.get('session_start')!();
  assert.match(blocked.statuses.get('desktop')!, /off/i);
  await assert.rejects(blocked.tools.get('desktop_observe')!.execute('id', {}, undefined, undefined, blocked.ctx), /lock/);
  const textOnly = harness('darwin', async () => true);
  textOnly.ctx.model = { input: ['text'] } as typeof textOnly.ctx.model;
  await textOnly.events.get('session_start')!();
  assert.match(textOnly.notifications.join(' '), /vision/i);
  assert.match(textOnly.statuses.get('desktop')!, /vision/i);
  textOnly.ctx.model = { input: ['text', 'image'] } as typeof textOnly.ctx.model;
  await textOnly.events.get('model_select')!();
  assert.match(textOnly.statuses.get('desktop')!, /on/i);
  assert.equal(textOnly.transport.calls.length, 1);
});
