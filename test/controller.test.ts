import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopController } from '../src/controller.ts';
import { REF_TTL_MS, type Reply } from '../src/protocol.ts';
import { MockTransport, NOW, PNG, PNG4, deferred, frame } from './fixtures.ts';
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

test('controller: health diagnostics distinguish Secure Input, each permission and malformed health', async () => {
  for (const [health, match, absent] of [
    [{ screenRecording: true, accessibility: true, secureInput: true }, /Secure Input is active/, /Missing permission|System Settings|Malformed/],
    [{ screenRecording: false, accessibility: true, secureInput: false }, /Missing permission: Screen Recording\./, /Accessibility|Secure Input|Malformed/],
    [{ screenRecording: true, accessibility: false, secureInput: false }, /Missing permission: Accessibility\./, /Screen Recording|Secure Input|Malformed/],
    [undefined, /Malformed.*rebuild/, /Missing permission|Secure Input/],
    [{ screenRecording: true, accessibility: true, secureInput: 'false' }, /Malformed/, /Missing permission|Secure Input/],
  ] as const) {
    const { c, t } = setup();
    t.handle = async () => ({ ok: true, health } as Reply);
    await assert.rejects(c.enable(), e => { assert.match((e as Error).message, match); assert.doesNotMatch((e as Error).message, absent); return true; });
    assert.equal(c.isEnabled, false); assert.equal(t.closed, true);
    assert.deepEqual(t.calls, [{ op: 'health' }]);
  }
});

test('controller: zoom is a new capture request, consumes ref, preserves image block and full act orientation', async () => {
  const { c, t } = setup(); await c.enable();
  const initial = await c.observe();
  const zoom = { ref: initial.details.ref, x: 0, y: 0, width: 1, height: 1 };
  const observed = await c.observe({ zoom });
  assert.deepEqual(t.calls.at(-1), { op: 'observe', zoom });
  assert.notEqual(observed.details.ref, zoom.ref);
  assert.deepEqual(observed.content[1], { type: 'image', mimeType: 'image/png', data: PNG });
  assert.equal(await c['tail'], undefined); assert.equal(Object.hasOwn(c['latest']!, 'png'), false);
  await assert.rejects(c.observe({ zoom }), /foreign/);
  const nested = await c.observe({ zoom: { ...zoom, ref: observed.details.ref } });
  const after = await c.act({ ref: nested.details.ref, action: 'move', x: 0, y: 0 });
  assert.deepEqual(after.details.view, { x: 0, y: 0, width: 1440, height: 900 });
  assert.equal(after.details.dispatched, true); assert.equal(after.details.verified, false);
  await c.observe({}); assert.deepEqual(t.calls.at(-1), { op: 'observe' });
});

test('controller: zoom rejects expired/future/foreign/invalid sources without capture', async () => {
  for (const age of [-1, REF_TTL_MS, REF_TTL_MS + 1]) {
    const { c, t, advance } = setup(); await c.enable(); const f = await c.observe(); advance(age);
    await assert.rejects(c.observe({ zoom: { ref: f.details.ref, x: 0, y: 0, width: 1, height: 1 } }), /Expired/);
    assert.equal(t.calls.length, 2);
  }
  const { c, t } = setup(); await c.enable(); const f = await c.observe();
  for (const zoom of [{ ref: 'foreign', x: 0, y: 0, width: 1, height: 1 },
    { ref: f.details.ref, x: 0, y: 0, width: 2, height: 1 }]) await assert.rejects(c.observe({ zoom }));
  assert.equal(t.calls.length, 2);
});

test('controller: observe wait is explicit, bounded, abortable and never revives a ref expiring during wait', async () => {
  const { c, t, advance } = setup(); await c.enable(); const f = await c.observe();
  for (const waitMs of [-1, 2001, NaN, 0.5]) await assert.rejects(c.observe({ waitMs }), /Invalid/);
  assert.equal(t.calls.length, 2);
  const waiting = c.observe({ zoom: { ref: f.details.ref, x: 0, y: 0, width: 1, height: 1 }, waitMs: 20 });
  await new Promise(resolve => setTimeout(resolve, 5)); advance(REF_TTL_MS);
  await assert.rejects(waiting, /Expired/);
  assert.equal(t.calls.length, 2);
  await assert.rejects(c.act(click(f.details.ref)), /No fresh/);
  const ac = new AbortController();
  const cancelled = c.observe({ waitMs: 2000 }, ac.signal);
  const rejected = assert.rejects(cancelled, /no input requested.*disabled/);
  await new Promise(resolve => setTimeout(resolve, 5)); ac.abort(); await rejected;
  assert.equal(t.calls.length, 2); assert.equal(c.isEnabled, false); assert.equal(t.closed, true);
});

test('controller: off during observe wait cancels before helper request; queued calls stay off', async () => {
  const { c, t } = setup(); await c.enable();
  const waiting = c.observe({ waitMs: 2000 });
  const rejected = assert.rejects(waiting, /no input requested/);
  await new Promise(resolve => setTimeout(resolve, 5));
  const queued = c.observe(); const off = assert.rejects(queued, /off/);
  await c.disable(); await rejected; await off;
  assert.deepEqual(t.calls, [{ op: 'health' }]);
});

test('controller: mismatched zoom geometry/view and non-full act results disable without retry', async () => {
  for (const invalid of ['geometry', 'view', 'ref', 'expired']) {
    const { c, t } = setup(); await c.enable(); const f = await c.observe();
    t.handle = async () => {
      const next = frame();
      if (invalid === 'geometry') next.geometry.pid++;
      if (invalid === 'view') next.view.width--;
      if (invalid === 'ref') next.ref = f.details.ref;
      if (invalid === 'expired') next.capturedAt -= REF_TTL_MS;
      return { ok: true, frame: next };
    };
    await assert.rejects(c.observe({ zoom: { ref: f.details.ref, x: 0, y: 0, width: 1, height: 1 } }), /no input requested/);
    assert.equal(c.isEnabled, false); assert.equal(t.calls.length, 3);
  }
  const { c, t } = setup(); await c.enable(); const f = await c.observe();
  t.handle = async () => ({ ok: true, frame: { ...frame(), view: { x: 10, y: 10, width: 100, height: 100 } } });
  await assert.rejects(c.act({ ref: f.details.ref, action: 'move', x: 0, y: 0 }), /outcome unknown.*Do NOT retry/);
  assert.equal(c.isEnabled, false);
});


test('controller: actual crop metadata maps selected source and nested views, then resets full screen', async () => {
  const { c, t } = setup(); await c.enable();
  t.handle = async () => ({ ok: true, frame: { ...frame(), width: 4, height: 4, png: PNG4 } });
  const full = await c.observe();
  const croppedView = { x: 360, y: 225, width: 720, height: 450 };
  t.handle = async () => ({ ok: true, frame: { ...frame(), width: 4, height: 4, png: PNG4, view: croppedView } });
  const cropped = await c.observe({ zoom: { ref: full.details.ref, x: 1, y: 1, width: 2, height: 2 } });
  assert.deepEqual(cropped.details.view, croppedView);
  assert.deepEqual(cropped.details.geometry, full.details.geometry);
  const nestedView = { x: 540, y: 337.5, width: 180, height: 112.5 };
  t.handle = async () => ({ ok: true, frame: { ...frame(), view: nestedView } });
  const nested = await c.observe({ zoom: { ref: cropped.details.ref, x: 1, y: 1, width: 1, height: 1 } });
  assert.deepEqual(nested.details.view, nestedView);
  t.handle = async () => ({ ok: true, frame: frame() });
  const after = await c.act({ ref: nested.details.ref, action: 'move', x: 0, y: 0 });
  assert.deepEqual(after.details.view, full.details.view);
});

test('controller: source expiring while zoom capture is in flight cannot be revived', async () => {
  const { c, t, advance } = setup(); await c.enable(); const full = await c.observe();
  t.handle = async () => {
    advance(REF_TTL_MS);
    return { ok: true, frame: { ...frame(), capturedAt: NOW + REF_TTL_MS } };
  };
  await assert.rejects(c.observe({ zoom: { ref: full.details.ref, x: 0, y: 0, width: 1, height: 1 } }), /Expired/);
  assert.equal(c['latest'], undefined);
  assert.equal(t.calls.length, 3);
});
