const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPluginQuarantine } = require("../runtime/plugin-recovery.cjs");

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
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("daemon plugin recovery verified");
