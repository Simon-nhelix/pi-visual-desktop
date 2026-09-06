import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Value } from 'typebox/value';
import { actionSchema, observeSchema, validateObserve, zoomView, captureSize, KEY_NAMES, imageToDisplay, validateAction, validateFrame } from '../src/protocol.ts';
import { frame } from './fixtures.ts';

test('protocol: exact pixel-center coordinate convention, Retina and non-Retina', () => {
  const f = { ...frame(), width: 1280, height: 800 };
  assert.deepEqual(imageToDisplay(0, 0, f), { x: 0.5625, y: 0.5625 });
  assert.deepEqual(imageToDisplay(1279, 799, f), { x: 1439.4375, y: 899.4375 });
  f.geometry = { ...f.geometry, x: -1440, y: 20, pixelWidth: 1440, pixelHeight: 900 };
  assert.deepEqual(imageToDisplay(0, 0, f), { x: -1439.4375, y: 20.5625 });
  for (const x of [-1, 1280, NaN, Infinity, 0.5]) assert.throws(() => imageToDisplay(x, 0, f));
});

test('protocol: strict action-specific fields and finite image ranges', () => {
  const base = { ref: 'test', action: 'click', x: 0, y: 0 };
  validateAction(base, 1, 1);
  for (const input of [null, [], {}, { ...base, extra: 1 }, { ...base, x: NaN }, { ...base, x: Infinity },
    { ...base, x: true }, { ...base, x: 0.1 }, { ...base, x: -1 }, { ...base, x: 1 },
    { ...base, action: 'constructor' }, { ...base, action: 'type', text: 'secret' }]) {
    assert.throws(() => validateAction(input, 1, 1));
  }
  for (const input of [
    { ref: 'test', action: 'type', text: '한😀\n\t' },
    { ref: 'test', action: 'key', key: 'return', modifiers: [] },
    { ref: 'test', action: 'key', key: 'a', modifiers: ['command'] },
    { ...base, action: 'scroll', dx: 0, dy: 1000 },
    { ...base, action: 'drag', toX: 0, toY: 0 },
    { ...base, action: 'double_click' }, { ...base, action: 'right_click' },
  ]) { validateAction(input, 1, 1); assert.equal(Value.Check(actionSchema, input), true); }
  for (const input of [
    { ref: 'test', action: 'type', text: '' }, { ref: 'test', action: 'type', text: '\uD800' },
    { ref: 'test', action: 'type', text: 'x'.repeat(2049) },
    { ref: 'test', action: 'key', key: 'return' },
    { ref: 'test', action: 'key', keyCode: 36, modifiers: [] },
    { ref: 'test', action: 'key', key: 'caps_lock', modifiers: [] },
    { ref: 'test', action: 'key', key: 'a', modifiers: ['command', 'command'] },
    { ref: 'test', action: 'key', key: 'a', modifiers: ['super'] },
    { ...base, action: 'scroll', dx: 0, dy: 0 }, { ...base, action: 'scroll', dx: 1001, dy: 0 },
  ]) assert.throws(() => validateAction(input, 1, 1));
  assert.equal(Value.Check(actionSchema, { ...base, extra: true }), false);
});

test('protocol: bounded named keys match the native code-owned mapping', async () => {
  const swift = await readFile(new URL('../native/DesktopHelper.swift', import.meta.url), 'utf8');
  const map = swift.split('private let keyCodes: [String: UInt16] = [')[1].split('\n]')[0];
  const names = [...map.matchAll(/"([a-z0-9_]+)": \d+/g)].map(m => m[1]);
  assert.deepEqual(names.sort(), [...KEY_NAMES].sort());
  assert.equal(new Set(names).size, names.length);
});

test('protocol: image payload dimensions and metadata validated without logging PNG', () => {
  validateFrame(frame());
  for (const invalid of [{ ...frame(), width: 2 }, { ...frame(), png: 'sensitive-not-a-png' },
    { ...frame(), capturedAt: NaN }, { ...frame(), width: 1281 }, { ...frame(), ref: 'foreign' },
    { ...frame(), geometry: { ...frame().geometry, height: 0 } }]) assert.throws(() => validateFrame(invalid));
});

test('protocol: zoom pixel edges compose through Retina, rotation, origins and fractional rounding', async () => {
  for (const [width, height, pixelWidth, pixelHeight, rotation] of [
    [1512, 982, 3024, 1964, 0], [982, 1512, 3024, 1964, 90], [1440, 900, 1440, 900, 0],
  ]) {
    const g = { ...frame().geometry, x: -1512, y: 42, width, height, pixelWidth, pixelHeight, rotation };
    const full = { ...frame(), geometry: g, view: { x: 0, y: 0, width, height }, ...captureSize(g, { x: 0, y: 0, width, height }) };
    const view = zoomView({ ref: full.ref, x: 100, y: 50, width: 300, height: 200 }, full);
    assert.equal(view.x, 100 * width / full.width);
    assert.equal(view.y, 50 * height / full.height);
    const crop = { ...full, view, ...captureSize(g, view) };
    const nestedView = zoomView({ ref: crop.ref, x: 3, y: 7, width: 20, height: 30 }, crop);
    const nested = { ...crop, view: nestedView, ...captureSize(g, nestedView) };
    const p = imageToDisplay(nested.width - 1, nested.height - 1, nested);
    assert.equal(p.x, g.x + nestedView.x + (nested.width - 0.5) * nestedView.width / nested.width);
    assert.equal(p.y, g.y + nestedView.y + (nested.height - 0.5) * nestedView.height / nested.height);
    assert.ok(crop.width > 300 && crop.height > 200, 'new capture has more detail than selected source pixels');
    const nativeScale = pixelWidth / Math.max(width, height);
    assert.ok(nested.width <= nestedView.width * nativeScale);
    assert.ok(nested.height <= nestedView.height * nativeScale);
    assert.ok(Math.max(crop.width, crop.height) <= 1280);
  }
});

test('protocol: observe schema and region bounds reject malformed, nonfinite and foreign selections', async () => {
  const f = { ...frame(), width: 100, height: 80 };
  const zoom = { ref: f.ref, x: 0, y: 0, width: 100, height: 80 };
  for (const o of [{}, { waitMs: 0 }, { waitMs: 2000 }, { zoom }, { zoom, waitMs: 1 }]) {
    validateObserve(o); assert.equal(Value.Check(observeSchema, o), true);
  }
  for (const o of [null, [], { extra: true }, { waitMs: NaN }, { waitMs: Infinity }, { waitMs: -1 },
    { waitMs: 2001 }, { waitMs: 1.5 }, { waitMs: true }, { zoom: null }, { zoom: {} },
    ...['x', 'y', 'width', 'height'].flatMap(k => [NaN, Infinity, -1, true, 1.5].map(n => ({ zoom: { ...zoom, [k]: n } }))),
    { zoom: { ...zoom, width: 0 } }, { zoom: { ...zoom, extra: true } }, { zoom: { ...zoom, ref: '' } }]) {
    assert.throws(() => validateObserve(o));
  }
  for (const z of [{ ...zoom, ref: 'foreign' }, { ...zoom, x: 1 }, { ...zoom, y: 1 }]) assert.throws(() => zoomView(z, f));
  assert.deepEqual(zoomView(zoom, f), f.view);
});

test('protocol: move accepts coordinates only; invalid capture views fail closed', () => {
  const move = { ref: 'test', action: 'move', x: 0, y: 0 };
  validateAction(move, 1, 1);
  assert.equal(Value.Check(actionSchema, move), true);
  for (const extra of [{ dx: 1 }, { modifiers: [] }, { toX: 0 }, { button: 'left' }]) assert.throws(() => validateAction({ ...move, ...extra }, 1, 1));
  for (const view of [undefined, { ...frame().view, x: -1 }, { ...frame().view, height: NaN },
    { ...frame().view, width: 1441 }, { x: 0, y: 0, width: 0.1, height: 0.1 }]) assert.throws(() => validateFrame({ ...frame(), view }));
});
