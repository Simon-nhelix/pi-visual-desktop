import { REF_TTL_MS, validateAction, validateFrame, type Frame, type Health, type Transport } from './protocol.ts';

export function imageResult(frame: Frame, dispatched: boolean) {
  const { png: _png, ...snapshot } = frame;
  const details = { ...snapshot, timestamp: new Date(frame.capturedAt).toISOString(),
    dispatched, verified: false as const, outcome: dispatched ? 'dispatched_not_verified' : 'observed' };
  return { content: [
    { type: 'text' as const, text: JSON.stringify(details) },
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
  private createTransport: () => Transport;
  private now: () => number;
  constructor(createTransport: () => Transport, now = Date.now) {
    this.createTransport = createTransport; this.now = now;
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
        if (!health || health.screenRecording !== true || health.accessibility !== true || health.secureInput !== false) {
          throw new Error('Desktop unavailable: enable Screen Recording and Accessibility for the local terminal/helper in System Settings > Privacy & Security, then restart Pi. Disable Secure Input manually if active. No permission prompt was requested.');
        }
        if (generation !== this.generation) throw new Error('Desktop enable cancelled.');
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
  observe(signal?: AbortSignal) {
    return this.operation(signal, async (t, s) => {
      this.latest = undefined;
      try {
        const reply = await t.request({ op: 'observe' }, s);
        if (!reply.ok) throw new NotDispatched(reply.error ?? 'Desktop observation failed.');
        s.throwIfAborted();
        validateFrame(reply.frame);
        const { png: _png, ...metadata } = reply.frame;
        this.latest = metadata;
        return imageResult(reply.frame, false);
      } catch (error) {
        if (error instanceof NotDispatched) throw error;
        this.enabled = false;
        this.generation++;
        await t.close();
        throw new Error('Desktop observation failed or cancelled; no input requested. Session disabled; /desktop on to reconnect.');
      }
    });
  }
  act(input: unknown, signal?: AbortSignal) {
    return this.operation(signal, async (t, s) => {
      const frame = this.latest;
      if (!frame) throw new Error('No fresh screenshot ref. Observe first.');
      validateAction(input, frame.width, frame.height);
      if (input.ref !== frame.ref || this.now() - frame.capturedAt >= REF_TTL_MS || this.now() < frame.capturedAt) {
        throw new Error('Expired, consumed or foreign screenshot ref. Observe again.');
      }
      this.latest = undefined; // Consume before any dispatch, including uncertain failures.
      try {
        const reply = await t.request({ op: 'act', ...input }, s);
        if (!reply.ok) {
          if (reply.outcome === 'not_dispatched') throw new NotDispatched(reply.error ?? 'Desktop preflight rejected action.');
          throw new Error('Helper reported an uncertain action.');
        }
        s.throwIfAborted();
        validateFrame(reply.frame);
        const { png: _png, ...metadata } = reply.frame;
        this.latest = metadata;
        return imageResult(reply.frame, true);
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
