import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopController } from '../src/controller.ts';
import { REF_TTL_MS, type Reply } from '../src/protocol.ts';
import { MockTransport, NOW, PNG, deferred, frame } from './fixtures.ts';
function setup() {
  const t = new MockTransport();
  let now = NOW;
  const c = new DesktopController(() => t, () => now);
  return { c, t, advance: (n: number) => { now += n; } };
}
const click = (ref: string) => ({ ref, action: 'click', x: 0, y: 0 });

test('controller: session opt-in required; permission/lock failure closes helper', async () => {
  const { c, t } = setup();
  await assert.rejects(c.observe(), /off/);
  assert.equal(t.calls.length, 0);
  t.handle = async () => ({ ok: false, error: 'Another session holds lock.' });
  await assert.rejects(c.enable(), /lock/);
  assert.equal(c.isEnabled, false);
  assert.equal(t.closed, true);
  t.handle = async () => ({ ok: true, health: { screenRecording: false, accessibility: true, secureInput: false } });
  await assert.rejects(c.enable(), /Screen Recording/);
  t.handle = async () => ({ ok: true, health: { screenRecording: true, accessibility: true, secureInput: true } });
  await assert.rejects(c.enable(), /Secure Input/);
});

test('controller: latest one-use ref; image block preserved and task success never asserted', async () => {
  const { c, t } = setup(); await c.enable();
  const first = await c.observe();
  assert.deepEqual(first.content[1], { type: 'image', mimeType: 'image/png', data: PNG });
  assert.equal(JSON.stringify(first.details).includes(PNG), false);
  const second = await c.observe();
  await assert.rejects(c.act(click(first.details.ref)), /foreign/);
  const after = await c.act(click(second.details.ref));
  assert.equal(after.details.dispatched, true); assert.equal(after.details.verified, false);
  assert.notEqual(after.details.ref, second.details.ref);
  await assert.rejects(c.act(click(second.details.ref)), /foreign/);
  assert.equal(t.calls.filter(a => a.op === 'act').length, 1);
  await c.disable(); await assert.rejects(c.act(click(after.details.ref)), /off/);
});

test('controller: idle queue retains no screenshot result on success or failure', async () => {
  const { c, t } = setup(); await c.enable();
  const observed = await c.observe();
  assert.equal(observed.content[1].data, PNG);
  // Inspect retained state directly, without nondeterministic garbage-collection assertions.
  assert.equal(await c['tail'], undefined);
  assert.equal(Object.hasOwn(c['latest']!, 'png'), false);
  const after = await c.act(click(observed.details.ref));
  assert.equal(after.content[1].data, PNG);
  assert.equal(await c['tail'], undefined);
  t.handle = async () => ({ ok: false, error: 'Observation rejected.' });
  await assert.rejects(c.observe(), /rejected/);
  assert.equal(await c['tail'], undefined);
  await c.disable();
});

test('controller: 120-second TTL boundary and future timestamps fail closed', async () => {
  assert.equal(REF_TTL_MS, 120_000);
  for (const age of [REF_TTL_MS, REF_TTL_MS + 1, -1]) {
    const { c, t, advance } = setup(); await c.enable(); const observed = await c.observe(); advance(age);
    await assert.rejects(c.act(click(observed.details.ref)), /Expired/);
    assert.equal(t.calls.filter(a => a.op === 'act').length, 0);
  }
  const { c, advance } = setup(); await c.enable(); const observed = await c.observe(); advance(REF_TTL_MS - 1);
  await c.act(click(observed.details.ref));
});

test('controller: foreign sessions and invalid coordinates never dispatch', async () => {
  const a = setup(), b = setup(); await a.c.enable(); await b.c.enable();
  const fa = await a.c.observe(), fb = await b.c.observe();
  await assert.rejects(b.c.act(click(fa.details.ref)), /foreign/);
  await assert.rejects(b.c.act({ ...click(fb.details.ref), x: NaN }), /Invalid/);
  assert.equal(b.t.calls.filter(a => a.op === 'act').length, 0);
});

test('controller: concurrent calls serialize, same ref dispatches once', async () => {
  const { c, t } = setup(); await c.enable(); const observed = await c.observe();
  const blocked = deferred<Reply>(), started = deferred<void>();
  t.handle = async () => { started.resolve(); return blocked.promise; };
  const one = c.act(click(observed.details.ref));
  const two = c.act(click(observed.details.ref));
  await started.promise;
  assert.equal(t.calls.filter(a => a.op === 'act').length, 1);
  blocked.resolve({ ok: true, frame: frame() }); await one;
  await assert.rejects(two, /foreign/);
});

test('controller: geometry/foreground preflight rejection consumes ref, never retries', async () => {
  const { c, t } = setup(); await c.enable(); const observed = await c.observe();
  t.handle = async () => ({ ok: false, outcome: 'not_dispatched', error: 'Main display geometry or foreground changed.' });
  await assert.rejects(c.act(click(observed.details.ref)), /geometry or foreground/);
  await assert.rejects(c.act(click(observed.details.ref)), /No fresh/);
  assert.equal(c.isEnabled, true);
  assert.equal(t.calls.filter(a => a.op === 'act').length, 1);
});

test('controller: timeout, malformed post-image and capture failure are unknown; off and no retry', async () => {
  for (const handle of [
    async (): Promise<Reply> => { throw new Error('timeout secret'); },
    async () => ({ ok: false, outcome: 'unknown', error: 'capture failed secret' }),
    async () => ({ ok: true, frame: { ...frame(), png: 'secret' } }),
  ]) {
    const { c, t } = setup(); await c.enable(); const observed = await c.observe(); t.handle = handle;
    await assert.rejects(c.act(click(observed.details.ref)), error => {
      assert.match((error as Error).message, /outcome unknown.*Do NOT retry/s);
      assert.doesNotMatch((error as Error).message, /secret/); return true;
    });
    assert.equal(c.isEnabled, false); assert.equal(t.closed, true);
    await assert.rejects(c.act(click(observed.details.ref)), /off/);
    assert.equal(t.calls.filter(a => a.op === 'act').length, 1);
  }
});

test('controller: pre-aborted and queued cancellation cause no input', async () => {
  const { c, t } = setup(); await c.enable(); const observed = await c.observe();
  await assert.rejects(c.act(click(observed.details.ref), AbortSignal.abort()));
  assert.equal(t.calls.filter(a => a.op === 'act').length, 0);
  const blocked = deferred<Reply>(), started = deferred<void>();
  t.handle = async () => { started.resolve(); return blocked.promise; };
  const observe = c.observe(); await started.promise;
  const ac = new AbortController(); const action = c.act(click(observed.details.ref), ac.signal); ac.abort();
  blocked.resolve({ ok: true, frame: frame() }); await observe;
  await assert.rejects(action);
  assert.equal(t.calls.filter(a => a.op === 'act').length, 0);
});

test('controller: off cancels in-flight input, blocks queued input and clears session', async () => {
  const { c, t } = setup(); await c.enable(); const observed = await c.observe();
  const started = deferred<void>();
  t.handle = async (_request, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); started.resolve();
  });
  const action = c.act(click(observed.details.ref));
  const failure = assert.rejects(action, /unknown/);
  await started.promise;
  const queued = c.act(click(observed.details.ref)); const rejected = assert.rejects(queued, /off/);
  await c.disable(); await failure; await rejected;
  assert.equal(c.isEnabled, false); assert.equal(t.closed, true);
  assert.equal(t.calls.filter(a => a.op === 'act').length, 1);
});

test('controller: failed observation invalidates the image and disconnects without claiming input', async () => {
  const { c, t } = setup(); await c.enable(); await c.observe();
  t.handle = async () => { throw new Error('pipe failed'); };
  await assert.rejects(c.observe(), /no input requested.*disabled/);
  assert.equal(c.isEnabled, false); assert.equal(t.closed, true);
});

test('controller: enable queued behind off cannot lose its new transport', async () => {
  const first = new MockTransport(), second = new MockTransport(); let created = 0;
  const c = new DesktopController(() => ++created === 1 ? first : second, () => NOW);
  await c.enable();
  const closed = deferred<void>(); first.close = async () => { await closed.promise; first.closed = true; };
  const off = c.disable(); const on = c.enable(); closed.resolve(); await off; await on;
  assert.equal(c.isEnabled, true);
  await c.observe(); assert.equal(second.calls.at(-1)!.op, 'observe');
});

test('controller: session reset while enable is pending cannot grant control', async () => {
  const { c, t } = setup(); const blocked = deferred<Reply>(), started = deferred<void>();
  t.handle = async () => { started.resolve(); return blocked.promise; };
  const enabling = c.enable(); const rejected = assert.rejects(enabling, /cancelled/); await started.promise;
  const disabled = c.disable();
  blocked.resolve({ ok: true, health: { screenRecording: true, accessibility: true, secureInput: false } });
  await rejected; await disabled; assert.equal(c.isEnabled, false);
});
