const fs = require("node:fs");
const path = require("node:path");

function packageFromDiagnostic(text) {
  if (!text || !/plugin tree failed to load|ERR_MODULE_NOT_FOUND/.test(text)) return null;
  let match = text.match(/failed to import loader entry .+?\((.+?)\/dsh\)/);
  if (match) return match[1].trim();
  match = text.match(
    /ERR_MODULE_NOT_FOUND[\s\S]{0,400}?node_modules[\\/]((?:@[^\\\s/]+[\\/])?[^\\\s/'"]+)/,
  );
  return match ? match[1].trim().replace(/\\/g, "/") : null;
}

function createPluginQuarantine(options) {
  const profileDir = options.profileDir;
  const maxCount = options.maxCount || 2;
  let count = 0;
  return function quarantineBrokenPlugin(diagnostic) {
    try {
      if (count >= maxCount) return null;
      const packageName = packageFromDiagnostic(diagnostic);
      if (!packageName || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(packageName)) {
        return null;
      }
      const manifestPath = path.join(profileDir, "package.json");
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const inDependencies = Boolean(
        manifest.dependencies && Object.prototype.hasOwnProperty.call(manifest.dependencies, packageName),
      );
      const bundles = manifest.dsh?.profile?.bundles;
      const inBundles = Array.isArray(bundles) && bundles.includes(packageName);
      if (!inDependencies && !inBundles) return null;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `${manifestPath}.bak-quarantine-${stamp}`;
      fs.copyFileSync(manifestPath, backupPath);
      if (inDependencies) delete manifest.dependencies[packageName];
      if (inBundles) manifest.dsh.profile.bundles = bundles.filter((name) => name !== packageName);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
      count += 1;
      return { packageName, backupPath };
    } catch (_error) {
      return null;
    }
  };
}

module.exports = { createPluginQuarantine, packageFromDiagnostic };
