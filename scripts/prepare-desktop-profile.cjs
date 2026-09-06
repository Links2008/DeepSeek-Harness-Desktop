const fs = require('node:fs');
const path = require('node:path');

function prepareDesktopProfile(dshHome, runtimeRoot) {
  const profileDir = path.join(dshHome, 'profiles', 'web');
  const manifestPath = path.join(profileDir, 'package.json');
  if (fs.existsSync(manifestPath)) return false;
  if (!fs.existsSync(path.join(runtimeRoot, 'node_modules', 'dshmarket', 'package.json'))) return false;
  fs.mkdirSync(profileDir, { recursive: true });
  const manifest = {
    name: 'dsh-profile-web', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'], patchReload: 'live' } },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return true;
}
module.exports = { prepareDesktopProfile };
