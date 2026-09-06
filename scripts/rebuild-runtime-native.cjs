const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  const root = path.resolve(__dirname, '..');
  const runtime = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'bundle', 'dsh-runtime');
  const electron = require('electron');
  const electronVersion = require('electron/package.json').version;
  // fs-ext uses Node's ABI, unlike the N-API/prebuilt modules shipped previously.
  if (fs.existsSync(path.join(runtime, 'node_modules', 'fs-ext', 'package.json'))) {
    const { rebuild } = await import('@electron/rebuild');
    await rebuild({
      buildPath: runtime, electronVersion, arch: 'x64',
      extraModules: ['fs-ext'], onlyModules: ['fs-ext'], force: true,
    });
  }
  const probe = spawnSync(electron, [
    '--expose-internals', path.join(__dirname, 'electron-node-runtime-probe.cjs'),
    path.join(runtime, 'node_modules'),
  ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (probe.error || probe.status !== 0) throw new Error(probe.error?.message || probe.stderr || probe.stdout);
  process.stdout.write(`Electron native runtime verified: ${probe.stdout.trim()}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
