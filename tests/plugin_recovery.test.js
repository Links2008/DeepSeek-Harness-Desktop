const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPluginQuarantine, packageFromDiagnostic } = require("../runtime/plugin-recovery.cjs");

assert.equal(packageFromDiagnostic("plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to import loader entry dsh-usage (dsh-usage): Cannot find package '@deepseek-ai/schemastery'"), "dsh-usage");
assert.equal(packageFromDiagnostic("plugin tree failed to load: failed to apply loader entry bot (@community/bot): duplicate route"), "@community/bot");
assert.equal(packageFromDiagnostic("ordinary stderr mentions (healthy)"), null);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-plugin-recovery-"));
const manifestPath = path.join(temporary, "package.json");
fs.writeFileSync(manifestPath, JSON.stringify({
  dependencies: { "broken-plugin": "1.0.0", healthy: "1.0.0" },
  dsh: { profile: { bundles: ["broken-plugin", "healthy"] } },
}, null, 2));

try {
  const quarantine = createPluginQuarantine({ profileDir: temporary, maxCount: 2 });
  assert.equal(quarantine("ordinary stderr"), null);
  const result = quarantine(
    "plugin tree failed to load; failed to import loader entry broken (broken-plugin/dsh)",
  );
  assert.equal(result.packageName, "broken-plugin");
  assert.equal(fs.existsSync(result.backupPath), true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.dependencies["broken-plugin"], undefined);
  assert.deepEqual(manifest.dsh.profile.bundles, ["healthy"]);
  assert.equal(quarantine("plugin tree failed to load: broken-plugin"), null);
  assert.equal(quarantine("plugin tree failed to load: failed to import loader entry unknown (unknown)"), null);
  const protectedManifest = {
    dependencies: { '@deepseek-ai/dsh-web-app': '1.0.0', healthy: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'healthy'] } },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(protectedManifest));
  assert.equal(quarantine('plugin tree failed to load: failed to import loader entry web (@deepseek-ai/dsh-web-app/dsh)'), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath)), protectedManifest);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("daemon plugin recovery verified");
