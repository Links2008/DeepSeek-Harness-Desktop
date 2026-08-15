const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const repository = "Links2008/DeepSeek-Harness-Desktop";

const readme = read("README.md");
const builder = read("electron-builder.yml");
const workflow = read(".github/workflows/upstream-sync.yml");
const verifier = read("scripts/verify-installed-runtime.ps1");
const lock = JSON.parse(read("upstream-lock.json"));

assert.match(readme, new RegExp(`github\\.com/${repository}/releases/latest`));
assert.match(readme, /docs\/images\/desktop-home\.png/);
assert.match(readme, /docs\/images\/agent-presets\.png/);
assert.match(readme, /docs\/images\/compact-sidebar\.png/);
assert.match(readme, /deepseek-ai\/deepseek-harness/);
assert.match(readme, /`master`/);
assert.match(readme, /47f943859bef60e4160492346772ded9b24f765a/);
assert.match(readme, /Links2008/);
assert.match(builder, /repo:\s*DeepSeek-Harness-Desktop/);
assert.match(workflow, /repo:\\s\*DeepSeek-Harness-Desktop/);
assert.match(verifier, /repo:\\s\*DeepSeek-Harness-Desktop/);
assert.equal(lock.repository, "deepseek-ai/deepseek-harness");
assert.equal(lock.branch, "master");

for (const image of [
  "docs/images/desktop-home.png",
  "docs/images/agent-presets.png",
  "docs/images/compact-sidebar.png",
]) {
  assert.equal(fs.existsSync(path.join(root, image)), true, `${image} must exist`);
}

for (const [name, content] of Object.entries({ readme, builder, workflow, verifier })) {
  assert.doesNotMatch(
    content,
    /Links2008\/Deepseek-Harness-(?:[/?#)"']|$)/i,
    `${name} still uses the old repository URL`,
  );
}

console.log("repository branding tests passed");
