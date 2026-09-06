import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapRegisteredTool, type ExtensionAPI, type ExtensionCommandContext, type ExtensionRunner,
  type RegisteredCommand, type RegisteredTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { registerDesktop, versionStatus } from '../src/index.ts';
import { DesktopController } from '../src/controller.ts';
import { MockTransport, NOW, PNG, deferred } from './fixtures.ts';

function harness(platform: NodeJS.Platform = 'darwin') {
  const transport = new MockTransport();
  const controller = new DesktopController(() => transport, () => NOW);
  const tools = new Map<string, ToolDefinition>();
  const events = new Map<string, () => Promise<void>>();
  let command!: RegisteredCommand;
  const notifications: string[] = [];
  let confirmations = 0, approved = true;
  const ctx = { mode: 'tui', hasUI: true, model: { input: ['text', 'image'] }, isIdle: () => true,
    ui: { notify: (message: string) => notifications.push(message), confirm: async () => { confirmations++; return approved; } },
  } as unknown as ExtensionCommandContext;
  const pi = { registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerCommand: (_name: string, definition: RegisteredCommand) => { command = definition; },
    on: (name: string, handler: () => Promise<void>) => events.set(name, handler),
  } as unknown as ExtensionAPI;
  registerDesktop(pi, controller, platform);
  return { transport, controller, tools, events, ctx, notifications,
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

test('Pi adapter: session start/shutdown resets opt-in; stale confirmation cannot enable', async () => {
  const h = harness(); await h.command('on'); await h.events.get('session_start')!();
  assert.equal(h.controller.isEnabled, false);
  await h.command('on'); await h.events.get('session_shutdown')!(); assert.equal(h.controller.isEnabled, false);
  const confirmation = deferred<boolean>();
  h.ctx.ui.confirm = () => confirmation.promise;
  const command = h.command('on');
  await h.events.get('session_shutdown')!(); confirmation.resolve(true); await command;
  assert.equal(h.controller.isEnabled, false);
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
  assert.match(await versionStatus(), /pi-visual-desktop 0\.1\.0 git=(?:[a-f0-9]{12} (?:clean|dirty)|unavailable)/);
  assert.equal(h.transport.calls.length, 0);
});
