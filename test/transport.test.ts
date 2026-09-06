import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { HelperTransport } from '../src/transport.ts';
const fixture = fileURLToPath(new URL('./helper-fixture.mjs', import.meta.url));
function fake(mode: string, timeout = 1000) { return new HelperTransport(process.execPath, timeout, [fixture, mode]); }

test('transport: persistent bounded JSON requests and split response chunks', async t => {
  const helper = fake('split'); t.after(() => helper.close());
  assert.deepEqual(await helper.request({ op: 'health' }), { ok: true });
  assert.deepEqual(await helper.request({ op: 'observe' }), { ok: true });
  await assert.rejects(helper.request({ text: 'x'.repeat(32768) }), /exceeded/);
});

test('transport: timeout terminates helper, poisons transport, no retries', async t => {
  const helper = fake('hang', 100); t.after(() => helper.close());
  await assert.rejects(helper.request({ op: 'act' }), /timed out.*no input retry/);
  await assert.rejects(helper.request({ op: 'act' }), /closed/);
});

test('transport: cancellation waits for graceful exit; pre-abort does not spawn', async t => {
  const missing = new HelperTransport('/not/a/real/helper'); t.after(() => missing.close());
  await assert.rejects(missing.request({}, AbortSignal.abort()), { name: 'AbortError' });
  const helper = fake('slow-cancel'); t.after(() => helper.close());
  const ac = new AbortController();
  const pending = helper.request({ op: 'act' }, ac.signal);
  const rejected = assert.rejects(pending, /cancelled.*no input retry/);
  await delay(150); const at = Date.now(); ac.abort(); await rejected;
  assert.ok(Date.now() - at >= 80, 'must wait for child cleanup/exit');
});

test('transport: forced termination is bounded if helper ignores SIGTERM', async t => {
  const helper = fake('ignore-term', 200); t.after(() => helper.close());
  const at = Date.now();
  await assert.rejects(helper.request({ op: 'act' }), /timed out/);
  assert.ok(Date.now() - at < 4000);
});

test('transport: crash, malformed response, oversized output, missing binary', async t => {
  for (const mode of ['exit', 'invalid', 'large']) {
    const helper = fake(mode); t.after(() => helper.close());
    await assert.rejects(helper.request({ op: 'act' }), error => {
      assert.doesNotMatch((error as Error).message, /secret/); return true;
    });
  }
  const missing = new HelperTransport('/not/a/real/helper'); t.after(() => missing.close());
  await assert.rejects(missing.request({ op: 'health' }), /unavailable/);
});

test('transport: mid-response exit clears buffered screenshot bytes before rejection', async t => {
  const helper = fake('partial-exit'); t.after(() => helper.close());
  await assert.rejects(helper.request({ op: 'observe' }), /helper exited/);
  assert.equal(helper['output'].length, 0);
  await helper.close(); await helper.close();
  assert.equal(helper['output'].length, 0);
  await assert.rejects(helper.request({ op: 'observe' }), /closed/);
});

test('transport: stderr is drained, concurrent request rejected and close is idempotent', async t => {
  const helper = fake('stderr'); t.after(() => helper.close());
  const first = helper.request({ text: 'sensitive user literal' });
  await assert.rejects(helper.request({}), /in progress/);
  assert.deepEqual(await first, { ok: true });
  await helper.close(); await helper.close();
  await assert.rejects(helper.request({}), /closed/);
});
