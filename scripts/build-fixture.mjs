import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('Scratch fixture requires macOS 14+.');
const contents = new URL('../build/DesktopScratch.app/Contents/', import.meta.url);
mkdirSync(new URL('MacOS/', contents), { recursive: true });
const result = spawnSync('xcrun', ['swiftc', '-swift-version', '5', '-O',
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
  'test/manual/Scratch.swift', '-o', 'build/DesktopScratch.app/Contents/MacOS/DesktopScratch'], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) throw new Error('Scratch fixture build failed.');
writeFileSync(new URL('Info.plist', contents), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>DesktopScratch</string>
<key>CFBundleIdentifier</key><string>local.pi-visual-desktop.scratch</string>
<key>CFBundleName</key><string>DesktopScratch</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
console.log('Built build/DesktopScratch.app; NOT launched. Owner opens it manually.');
