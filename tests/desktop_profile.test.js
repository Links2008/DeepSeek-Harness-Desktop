const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareDesktopProfile } = require('../scripts/prepare-desktop-profile.cjs');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.match(main, /const dshHome = \(\) => process\.env\.DSH_HOME/);
assert.doesNotMatch(main, /path\.join\(app\.getPath\(['"]home['"]\), ['"]\.dsh['"],/,
  'all profile owners must use the DSH_HOME-aware helper');
const prebundle = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prebundle-runtime-startup.cjs'), 'utf8');
assert.match(prebundle, /cliManifest\.dependencies = .*dshmarket: store\.version/,
  'the store must be part of the upstream installation fallback dependency closure');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-seed-'));
try {
  const home = path.join(temporary, 'home');
  const runtime = path.join(temporary, 'runtime');
  assert.equal(prepareDesktopProfile(home, runtime), false);
  fs.mkdirSync(path.join(runtime, 'node_modules', 'dshmarket'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'node_modules', 'dshmarket', 'package.json'), '{}');
  assert.equal(prepareDesktopProfile(home, runtime), true);
  const file = path.join(home, 'profiles', 'web', 'package.json');
  assert.ok(JSON.parse(fs.readFileSync(file)).dsh.profile.bundles.includes('dshmarket'));
  fs.writeFileSync(file, '{"private":true,"dependencies":{"custom":"1.0.0"}}');
  assert.equal(prepareDesktopProfile(home, runtime), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"private":true,"dependencies":{"custom":"1.0.0"}}');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('new-profile store seeding preserves existing profiles');
