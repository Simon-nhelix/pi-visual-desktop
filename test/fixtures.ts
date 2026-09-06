import { randomUUID } from 'node:crypto';
import type { Frame, Reply, Transport } from '../src/protocol.ts';
export const NOW = 1_000_000;
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
export function frame(): Frame {
  return { ref: randomUUID(), capturedAt: NOW, width: 1, height: 1, png: PNG,
    geometry: { displayID: 1, x: 0, y: 0, width: 1440, height: 900,
      pixelWidth: 2880, pixelHeight: 1800, rotation: 0, pid: 7, bundle: 'test.scratch', launched: 1 } };
}
export class MockTransport implements Transport {
  calls: Record<string, unknown>[] = [];
  closed = false;
  handle: (request: Record<string, unknown>, signal?: AbortSignal) => Promise<Reply> = async request =>
    request.op === 'health' ? { ok: true, health: { screenRecording: true, accessibility: true, secureInput: false } } : { ok: true, frame: frame() };
  async request(request: Record<string, unknown>, signal?: AbortSignal) {
    this.calls.push(request);
    return this.handle(request, signal);
  }
  async close() { this.closed = true; }
}
export function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
