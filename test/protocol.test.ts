import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Value } from 'typebox/value';
import { actionSchema, KEY_NAMES, imageToDisplay, validateAction, validateFrame } from '../src/protocol.ts';
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
