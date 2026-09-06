// A pipe-only fake helper. Never captures or posts input.
import { createInterface } from 'node:readline';
const mode = process.argv[2];
if (mode === 'ignore-term') process.on('SIGTERM', () => {});
if (mode === 'slow-cancel') process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));
createInterface({ input: process.stdin }).on('line', () => {
  if (mode === 'hang' || mode === 'ignore-term' || mode === 'slow-cancel') return;
  if (mode === 'exit') return process.exit(7);
  if (mode === 'partial-exit') {
    return process.stdout.write('{"ok":true,"frame":{"png":"partial-screenshot', () => process.exit(7));
  }
  if (mode === 'invalid') return process.stdout.write('not JSON secret\n');
  if (mode === 'large') return process.stdout.write('x'.repeat(10_500_001));
  if (mode === 'stderr') process.stderr.write('sensitive text must never escape\n');
  if (mode === 'split') {
    process.stdout.write('{"ok":');
    setTimeout(() => process.stdout.write('true}\n'), 10);
    return;
  }
  process.stdout.write('{"ok":true}\n');
});
