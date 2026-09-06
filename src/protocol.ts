import { Type, type Static } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';

export const MAX_EDGE = 1280;
export const REF_TTL_MS = 120_000;
export const KEY_NAMES = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'return', 'tab', 'escape', 'backspace', 'delete', 'left', 'right', 'up', 'down', 'home', 'end', 'page_up', 'page_down', 'space',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'minus', 'equal', 'left_bracket', 'right_bracket', 'backslash', 'semicolon', 'quote', 'comma', 'period', 'slash', 'grave',
] as const;
export const actionSchema = Type.Object({
  ref: Type.String({ minLength: 1, maxLength: 80 }),
  action: StringEnum(['click', 'double_click', 'right_click', 'scroll', 'drag', 'type', 'key']),
  x: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_EDGE - 1 })),
  y: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_EDGE - 1 })),
  toX: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_EDGE - 1 })),
  toY: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_EDGE - 1 })),
  dx: Type.Optional(Type.Integer({ minimum: -1000, maximum: 1000 })),
  dy: Type.Optional(Type.Integer({ minimum: -1000, maximum: 1000 })),
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  key: Type.Optional(StringEnum(KEY_NAMES)),
  modifiers: Type.Optional(Type.Array(StringEnum(['command', 'shift', 'option', 'control']), { maxItems: 4, uniqueItems: true })),
}, { additionalProperties: false });
export type Action = Static<typeof actionSchema>;
export interface Geometry {
  displayID: number; x: number; y: number; width: number; height: number;
  pixelWidth: number; pixelHeight: number; rotation: number;
  pid: number; bundle: string; launched: number;
}
export interface Frame {
  ref: string; capturedAt: number; width: number; height: number;
  geometry: Geometry; png: string;
}
export interface Health { screenRecording: boolean; accessibility: boolean; secureInput: boolean }
export interface Reply { ok: boolean; error?: string; outcome?: string; health?: Health; frame?: Frame }
export interface Transport {
  request(request: Record<string, unknown>, signal?: AbortSignal): Promise<Reply>;
  close(): Promise<void>;
}
const fields: Record<Action['action'], string[]> = {
  click: ['x', 'y'], double_click: ['x', 'y'], right_click: ['x', 'y'],
  scroll: ['x', 'y', 'dx', 'dy'], drag: ['x', 'y', 'toX', 'toY'],
  type: ['text'], key: ['key', 'modifiers'],
};
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
export function validateAction(value: unknown, width: number, height: number): asserts value is Action {
  const fail = () => { throw new Error('Invalid desktop action fields or range.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const a = value as Record<string, unknown>;
  if (typeof a.ref !== 'string' || !a.ref.length || a.ref.length > 80 || typeof a.action !== 'string' || !Object.hasOwn(fields, a.action)) return fail();
  const required = fields[a.action as Action['action']];
  if (Object.keys(a).some(k => !['ref', 'action', ...required].includes(k)) || required.some(k => !(k in a))) return fail();
  for (const k of ['x', 'toX']) if (k in a && !integer(a[k], 0, width - 1)) return fail();
  for (const k of ['y', 'toY']) if (k in a && !integer(a[k], 0, height - 1)) return fail();
  for (const k of ['dx', 'dy']) if (k in a && !integer(a[k], -1000, 1000)) return fail();
  if (a.action === 'scroll' && a.dx === 0 && a.dy === 0) return fail();
  if (a.action === 'type' && (typeof a.text !== 'string' || a.text.length < 1 || a.text.length > 2048 || !a.text.isWellFormed())) return fail();
  if (a.action === 'key' && (typeof a.key !== 'string' || !(KEY_NAMES as readonly string[]).includes(a.key) ||
    !Array.isArray(a.modifiers) || a.modifiers.length > 4 || new Set(a.modifiers).size !== a.modifiers.length ||
    a.modifiers.some(m => !['command', 'shift', 'option', 'control'].includes(m)))) return fail();
}

/** Integer image pixel indices map to the pixel center in Quartz global points (top-left origin). */
export function imageToDisplay(x: number, y: number, frame: Pick<Frame, 'width' | 'height' | 'geometry'>) {
  if (!integer(x, 0, frame.width - 1) || !integer(y, 0, frame.height - 1)) throw new Error('Coordinate outside screenshot.');
  return { x: frame.geometry.x + (x + 0.5) * frame.geometry.width / frame.width,
    y: frame.geometry.y + (y + 0.5) * frame.geometry.height / frame.height };
}

export function validateFrame(value: unknown): asserts value is Frame {
  const f = value as Frame | undefined;
  if (!f || typeof f.ref !== 'string' || !/^[0-9a-f-]{36}$/i.test(f.ref) || !Number.isFinite(f.capturedAt) ||
    !integer(f.width, 1, MAX_EDGE) || !integer(f.height, 1, MAX_EDGE) || typeof f.png !== 'string' || f.png.length > 10_000_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(f.png)) throw new Error('Invalid helper screenshot.');
  const png = Buffer.from(f.png, 'base64');
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(16) !== f.width || png.readUInt32BE(20) !== f.height) throw new Error('Screenshot dimensions do not match PNG.');
  const g = f.geometry;
  if (!g || ['displayID', 'x', 'y', 'width', 'height', 'pixelWidth', 'pixelHeight', 'rotation', 'pid', 'launched']
    .some(k => !Number.isFinite(g[k as keyof Geometry])) || typeof g.bundle !== 'string' ||
    g.width <= 0 || g.height <= 0 || g.pixelWidth <= 0 || g.pixelHeight <= 0 || g.pid <= 0) throw new Error('Invalid helper geometry.');
}
