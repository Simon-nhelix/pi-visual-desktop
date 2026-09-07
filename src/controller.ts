import { setTimeout as delay } from 'node:timers/promises';
import { REF_TTL_MS, validateAction, validateFrame, validateObserve, zoomView, type Frame, type CaptureView, type Geometry, type Health, type Transport } from './protocol.ts';

interface Timing { totalMs: number; queueMs: number }
export function imageResult(frame: Frame, dispatched: boolean, timing: Timing = { totalMs: 0, queueMs: 0 }) {
  const { png: _png, ...snapshot } = frame;
  const full = frame.view.x === 0 && frame.view.y === 0 && frame.view.width === frame.geometry.width && frame.view.height === frame.geometry.height;
  const details = { ...snapshot, timestamp: new Date(frame.capturedAt).toISOString(),
    expiresAt: new Date(frame.capturedAt + REF_TTL_MS).toISOString(), timing,
    dispatched, verified: false as const, outcome: dispatched ? 'dispatched_not_verified' : 'observed' };
  // Full OS geometry remains in details; the model needs the returned image's coordinates, not Retina math.
  const text = `${frame.width}x${frame.height} ${full ? 'full display' : 'zoom'} | app=${JSON.stringify(frame.geometry.bundle)}\n` +
    `ref=${frame.ref} | expires=${details.expiresAt}\n` +
    `Use these image pixels (0..${frame.width - 1}, 0..${frame.height - 1}); latest ref, one use. ` +
    `${dispatched ? 'Input sent; task not verified. Inspect image before next action.' : 'Observed; no input sent.'}\n` +
    `Elapsed ${timing.totalMs}ms (queue ${timing.queueMs}ms).`;
  return { content: [
    { type: 'text' as const, text },
    { type: 'image' as const, mimeType: 'image/png' as const, data: frame.png },
  ], details };
}

export class DesktopController {
  private transport?: Transport;
  private latest?: Omit<Frame, 'png'>;
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private activeAbort?: AbortController;
  private enabled = false;
  private customSettle = false;
  private createTransport: () => Transport;
  private now: () => number;
  private monotonic: () => number;
  constructor(createTransport: () => Transport, now = Date.now, monotonic = () => performance.now()) {
    this.createTransport = createTransport; this.now = now; this.monotonic = monotonic;
  }
  private timing(requestedAt: number, startedAt: number): Timing {
    return { totalMs: Math.round(Math.max(0, this.monotonic() - requestedAt)),
      queueMs: Math.round(Math.max(0, startedAt - requestedAt)) };
  }
  get isEnabled() { return this.enabled; }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(() => {}, () => {}); // Queue state must not retain image results.
    return result;
  }
  async enable(): Promise<Health> {
    const generation = this.generation;
    return this.serial(async () => {
      if (generation !== this.generation) throw new Error('Desktop enable cancelled.');
      if (this.enabled) throw new Error('Desktop already enabled.');
      const transport = this.transport = this.createTransport();
      try {
        const reply = await transport.request({ op: 'health' });
        if (!reply.ok) throw new Error(reply.error ?? 'Desktop helper refused session.');
        const health = reply.health;
        if (!health || ['screenRecording', 'accessibility', 'secureInput'].some(k => typeof health[k as keyof Health] !== 'boolean')) {
          throw new Error('Malformed desktop helper health response; rebuild with npm run setup. Desktop stays off.');
        }
        const blockers = [];
        if (health.secureInput) blockers.push('Secure Input is active; finish protected input manually before enabling desktop.');
        const missing = [!health.screenRecording && 'Screen Recording', !health.accessibility && 'Accessibility'].filter(Boolean);
        if (missing.length) blockers.push(`Missing permission: ${missing.join(' and ')}. Enable manually in System Settings > Privacy & Security, then restart Pi. No permission prompt was requested.`);
        if (blockers.length) throw new Error(`Desktop unavailable: ${blockers.join(' ')}`);
        if (generation !== this.generation) throw new Error('Desktop enable cancelled.');
        this.customSettle = Array.isArray(reply.capabilities) && reply.capabilities.includes('settleMs');
        this.enabled = true;
        return health;
      } catch (error) { await transport.close(); this.transport = undefined; throw error; }
    });
  }
  async disable(): Promise<void> {
    this.generation++;
    this.enabled = false;
    this.latest = undefined;
    this.activeAbort?.abort();
    const closing = this.transport?.close();
    return this.serial(async () => {
      await closing;
      this.transport = undefined;
    });
  }
  private operation<T>(signal: AbortSignal | undefined, fn: (t: Transport, s: AbortSignal) => Promise<T>) {
    const generation = this.generation;
    return this.serial(async () => {
      signal?.throwIfAborted();
      if (!this.enabled || !this.transport || generation !== this.generation) throw new Error('Desktop is off. User must confirm /desktop on in the local TUI.');
      const abort = this.activeAbort = new AbortController();
      const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
      try { return await fn(this.transport, combined); }
      finally { this.activeAbort = undefined; }
    });
  }
  observe(input: unknown = {}, signal?: AbortSignal) {
    const requestedAt = this.monotonic();
    return this.operation(signal, async (t, s) => {
      const startedAt = this.monotonic();
      validateObserve(input);
      const source = this.latest;
      let view: CaptureView | undefined;
      if (input.zoom) {
        if (!source) throw new Error('No fresh screenshot ref. Observe first.');
        this.requireFresh(source, input.zoom.ref);
        view = zoomView(input.zoom, source);
      }
      this.latest = undefined;
      try {
        if (input.waitMs) await delay(input.waitMs, undefined, { signal: s });
        s.throwIfAborted();
        if (input.zoom) this.requireFresh(source!, input.zoom.ref);
        const reply = await t.request({ op: 'observe', ...(input.zoom ? { zoom: input.zoom } : {}) }, s);
        if (!reply.ok) throw new NotDispatched(reply.error ?? 'Desktop observation failed.');
        s.throwIfAborted();
        validateFrame(reply.frame);
        if (this.now() < reply.frame.capturedAt || this.now() - reply.frame.capturedAt >= REF_TTL_MS) throw new Error('Stale helper screenshot.');
        if (input.zoom) this.requireFresh(source!, input.zoom.ref);
        if (source?.ref === reply.frame.ref) throw new Error('Helper reused screenshot ref.');
        if (view && ((Object.keys(source!.geometry) as (keyof Geometry)[]).some(k => reply.frame!.geometry[k] !== source!.geometry[k]) ||
          ['x', 'y', 'width', 'height'].some(k => Math.abs(reply.frame!.view[k as keyof CaptureView] - view[k as keyof CaptureView]) > 1e-7))) {
          throw new Error('Helper zoom does not match source snapshot.');
        }
        if (!view) this.requireFullView(reply.frame);
        const { png: _png, ...metadata } = reply.frame;
        this.latest = metadata;
        return imageResult(reply.frame, false, this.timing(requestedAt, startedAt));
      } catch (error) {
        if (error instanceof NotDispatched) throw error;
        this.enabled = false;
        this.generation++;
        await t.close();
        throw new Error('Desktop observation failed or cancelled; no input requested. Session disabled; /desktop on to reconnect.');
      }
    });
  }
  private requireFresh(frame: Omit<Frame, 'png'>, ref: string) {
    if (ref !== frame.ref || this.now() - frame.capturedAt >= REF_TTL_MS || this.now() < frame.capturedAt) {
      throw new NotDispatched('Expired, consumed or foreign screenshot ref. Observe again.');
    }
  }
  private requireFullView(frame: Frame) {
    const v = frame.view, g = frame.geometry;
    if (v.x !== 0 || v.y !== 0 || v.width !== g.width || v.height !== g.height) throw new Error('Expected full-display capture view.');
  }
  act(input: unknown, signal?: AbortSignal) {
    const requestedAt = this.monotonic();
    return this.operation(signal, async (t, s) => {
      const startedAt = this.monotonic();
      const frame = this.latest;
      if (!frame) throw new Error('No fresh screenshot ref. Observe first.');
      validateAction(input, frame.width, frame.height);
      if ('settleMs' in input && !this.customSettle) throw new Error('Native helper needs an update for settleMs. No input was sent. End the Pi session, run npm run setup in the plugin directory, then restart; do not repeat with the unsupported field.');
      this.requireFresh(frame, input.ref);
      this.latest = undefined; // Consume before any dispatch, including uncertain failures.
      try {
        const reply = await t.request({ op: 'act', ...input }, s);
        if (!reply.ok) {
          if (reply.outcome === 'not_dispatched') throw new NotDispatched(`${reply.error ?? 'Desktop preflight rejected action.'} No input was sent. Observe a fresh frame, then decide a new action; do not reuse the old ref.`);
          throw new Error('Helper reported an uncertain action.');
        }
        s.throwIfAborted();
        validateFrame(reply.frame);
        if (this.now() < reply.frame.capturedAt || this.now() - reply.frame.capturedAt >= REF_TTL_MS) throw new Error('Stale helper screenshot.');
        this.requireFullView(reply.frame);
        if (reply.frame.ref === frame.ref) throw new Error('Helper reused screenshot ref.');
        const { png: _png, ...metadata } = reply.frame;
        this.latest = metadata;
        return imageResult(reply.frame, true, this.timing(requestedAt, startedAt));
      } catch (error) {
        if (error instanceof NotDispatched) throw error;
        // Unknown outcomes require explicit user re-enable, not another model input attempt.
        this.enabled = false;
        this.generation++;
        await t.close();
        throw new Error('Desktop outcome unknown (input may have been dispatched; task not verified). Do NOT retry input. Inspect desktop manually, then /desktop on and observe.');
      }
    });
  }
}
class NotDispatched extends Error {}
