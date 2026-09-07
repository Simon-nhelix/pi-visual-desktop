import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { actionSchema, validateAction, type Reply } from '../src/protocol.ts';
import { DesktopController } from '../src/controller.ts';
import { MockTransport, NOW, PNG, deferred, frame } from './fixtures.ts';

const click = (ref: string) => ({ ref, action: 'click', x: 0, y: 0 });

test('feedback: settleMs is optional, bounded, and independent of action-specific fields', () => {
  for (const settleMs of [0, 250, 750, 2000]) {
    const a = { ...click('ref'), settleMs };
    assert.equal(Value.Check(actionSchema, a), true);
    validateAction(a, 1, 1);
  }
  for (const settleMs of [undefined, null, -1, 2001, 0.5, NaN, Infinity, true, '500']) {
    assert.throws(() => validateAction({ ...click('ref'), settleMs }, 1, 1));
  }
  validateAction(click('ref'), 1, 1);
  assert.throws(() => validateAction({ ...click('ref'), settleMs: 500, text: 'not a type action' }, 1, 1));
});

test('feedback: custom settle crosses one input request; no implicit repeat or extra observation', async () => {
  const t = new MockTransport(), c = new DesktopController(() => t, () => NOW);
  await c.enable(); const observed = await c.observe();
  await c.act({ ...click(observed.details.ref), settleMs: 800 });
  assert.deepEqual(t.calls.map(call => call.op), ['health', 'observe', 'act']);
  assert.equal(t.calls.at(-1)!.settleMs, 800);
  await c.disable();
});

test('feedback: compact model content preserves pixels/ref/expiry while internal geometry remains details only', async () => {
  const t = new MockTransport(), c = new DesktopController(() => t, () => NOW);
  await c.enable(); const observed = await c.observe();
  const text = observed.content[0].text!;
  assert.match(text, /image pixels/);
  assert.match(text, /full display/);
  assert.ok(text.includes(observed.details.ref));
  assert.ok(text.includes(new Date(NOW + 120_000).toISOString()));
  assert.doesNotMatch(text, /pixelWidth|pixelHeight|launched|displayID|"geometry"/);
  assert.equal(observed.details.geometry.pixelWidth, 2880);
  assert.deepEqual(observed.content[1], { type: 'image', mimeType: 'image/png', data: PNG });
  const after = await c.act(click(observed.details.ref));
  assert.match(after.content[0].text!, /not verified/);
  assert.equal(after.details.verified, false);
  assert.ok(Number.isFinite(after.details.timing.totalMs));
  assert.ok(after.details.timing.totalMs >= after.details.timing.queueMs);
  assert.equal(after.details.expiresAt, new Date(NOW + 120_000).toISOString());
  await c.disable();
});

test('feedback: preflight refusal says no input sent and permits fresh observation without re-enabling', async () => {
  const t = new MockTransport(), c = new DesktopController(() => t, () => NOW);
  await c.enable(); const observed = await c.observe();
  t.handle = async () => ({ ok: false, outcome: 'not_dispatched', error: 'Foreground changed.' });
  await assert.rejects(c.act(click(observed.details.ref)), /No input was sent.*Observe/s);
  assert.equal(c.isEnabled, true);
  t.handle = async () => ({ ok: true, frame: frame() });
  await c.observe();
  assert.equal(t.calls.filter(call => call.op === 'act').length, 1);
  await c.disable();
});

test('feedback: total latency includes queue delay, measured independently of snapshot wall clock', async () => {
  let monotonic = 0;
  const t = new MockTransport(), c = new DesktopController(() => t, () => NOW, () => monotonic);
  await c.enable();
  t.handle = async () => { monotonic += 4; return { ok: true, frame: frame() }; };
  monotonic = 10;
  const pending = c.observe(); monotonic = 17;
  const observed = await pending;
  assert.deepEqual(observed.details.timing, { totalMs: 11, queueMs: 7 });
  await c.disable();
});

test('feedback: older native helper rejects custom settling locally, before any input request', async () => {
  const t = new MockTransport();
  t.handle = async request => request.op === 'health'
    ? { ok: true, health: { screenRecording: true, accessibility: true, secureInput: false } }
    : { ok: true, frame: frame() };
  const c = new DesktopController(() => t, () => NOW);
  await c.enable(); const observed = await c.observe();
  await assert.rejects(c.act({ ...click(observed.details.ref), settleMs: 800 }), /helper.*update.*No input was sent/s);
  assert.deepEqual(t.calls.map(call => call.op), ['health', 'observe']);
  assert.equal(c.isEnabled, true);
  await c.disable();
});

test('feedback: cancellation during custom settling remains unknown, disables and never retries', async () => {
  const t = new MockTransport(), c = new DesktopController(() => t, () => NOW);
  await c.enable(); const observed = await c.observe();
  const entered = deferred<void>();
  t.handle = async (_request, signal) => new Promise<Reply>((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    entered.resolve();
  });
  const abort = new AbortController();
  const action = c.act({ ...click(observed.details.ref), settleMs: 2000 }, abort.signal);
  const rejected = assert.rejects(action, /outcome unknown.*Do NOT retry/s);
  await entered.promise; abort.abort(); await rejected;
  assert.equal(c.isEnabled, false);
  assert.equal(t.calls.filter(call => call.op === 'act').length, 1);
});
