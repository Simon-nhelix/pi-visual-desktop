import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('Only macOS 14+ is supported.');
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
const result = spawnSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-parse-as-library',
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
  'native/DesktopHelper.swift', '-o', 'build/desktop-helper.next'], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) {
  rmSync(new URL('../build/desktop-helper.next', import.meta.url), { force: true });
  throw new Error('Swift build failed; install Xcode Command Line Tools explicitly.');
}
renameSync(new URL('../build/desktop-helper.next', import.meta.url), new URL('../build/desktop-helper', import.meta.url));
console.log('Built build/desktop-helper (no capture or input performed).');
