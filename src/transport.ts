import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Reply, Transport } from './protocol.ts';

/** One local helper per opt-in; its kernel flock lives until process exit. No shell or retries. */
export class HelperTransport implements Transport {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: { resolve: (r: Reply) => void; reject: (e: Error) => void; cleanup: () => void };
  private output = Buffer.alloc(0);
  private stopped = false;
  private fault?: Error;
  private exited?: Promise<void>;
  private killTimer?: NodeJS.Timeout;
  private executable: string;
  private timeoutMs: number;
  private args: string[];
  constructor(executable: string, timeoutMs = 10_000, args: string[] = []) {
    this.executable = executable; this.timeoutMs = timeoutMs; this.args = args;
  }

  private start() {
    const child = this.child = spawn(this.executable, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    // stderr is deliberately drained, never included in diagnostics or logs.
    child.stderr.resume();
    this.exited = new Promise(resolve => {
      child.once('close', () => {
        this.stopped = true;
        this.output = Buffer.alloc(0);
        clearTimeout(this.killTimer);
        const pending = this.pending;
        this.pending = undefined;
        pending?.cleanup();
        pending?.reject(this.fault ?? new Error('Desktop helper exited; outcome unknown if input was requested. Run npm run setup; check /desktop status.'));
        resolve();
      });
    });
    child.once('error', () => this.stop(new Error('Desktop helper unavailable. Run npm run setup on macOS 14+.')));
    child.stdin.on('error', () => this.stop(new Error('Desktop helper input channel closed.')));
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) return;
      this.output = Buffer.concat([this.output, chunk]);
      if (this.output.length > 10_500_000) return this.stop(new Error('Desktop helper response exceeded limit.'));
      const end = this.output.indexOf(10);
      if (end < 0) return;
      if (!this.pending || end !== this.output.length - 1) return this.stop(new Error('Invalid desktop helper framing.'));
      let reply: Reply;
      try {
        reply = JSON.parse(this.output.subarray(0, end).toString('utf8'));
        if (!reply || typeof reply.ok !== 'boolean') throw new Error();
      } catch { return this.stop(new Error('Invalid desktop helper response.')); }
      this.output = Buffer.alloc(0);
      const pending = this.pending;
      this.pending = undefined;
      pending.cleanup();
      pending.resolve(reply);
    });
  }
  private stop(error: Error) {
    if (this.stopped) return;
    this.stopped = true;
    this.fault = error;
    this.output = Buffer.alloc(0);
    this.child?.kill('SIGTERM');
    // Native cancellation checks run between input events; all held input is released before capture.
    this.killTimer = setTimeout(() => this.child?.kill('SIGKILL'), 2000);
    this.killTimer.unref();
  }
  async request(request: Record<string, unknown>, signal?: AbortSignal): Promise<Reply> {
    signal?.throwIfAborted();
    if (this.stopped) throw new Error('Desktop helper closed; explicitly enable a new session.');
    if (this.pending) throw new Error('Desktop helper request already in progress.');
    const input = JSON.stringify(request) + '\n';
    if (Buffer.byteLength(input) > 32_768) throw new Error('Desktop helper request exceeded limit.');
    if (!this.child) this.start();
    return new Promise((resolve, reject) => {
      const abort = () => this.stop(new Error('Desktop operation cancelled; no input retry.'));
      const timer = setTimeout(() => this.stop(new Error('Desktop operation timed out; no input retry.')), this.timeoutMs);
      this.pending = { resolve, reject, cleanup: () => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
      } };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else this.child!.stdin.write(input);
    });
  }
  async close(): Promise<void> {
    if (this.child) {
      this.stop(new Error('Desktop disabled; pending operation cancelled.'));
      await this.exited;
    } else this.stopped = true;
  }
}
