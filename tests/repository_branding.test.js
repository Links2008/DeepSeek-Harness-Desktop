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
assert.doesNotMatch(readme, /deepseek-ai\/deepseek-harness\/commit\/[0-9a-f]{40}/,
  "README must use upstream-lock.json instead of a commit that becomes stale on every sync");
assert.match(readme, /Links2008/);
assert.match(readme, /v4 是重大架构升级；v4\.0\.1 是首个稳定性更新/);
assert.match(readme, /安装包轻量化/);
assert.match(readme, /DSH-IM/);
assert.match(builder, /repo:\s*DeepSeek-Harness-Desktop/);
assert.match(workflow, /repo:\\s\*DeepSeek-Harness-Desktop/);
assert.match(verifier, /repo:\\s\*DeepSeek-Harness-Desktop/);
assert.equal(lock.repository, "deepseek-ai/deepseek-harness");
assert.equal(lock.branch, "master");
assert.match(lock.commit, /^[0-9a-f]{40}$/,
  "upstream-lock.json must carry one full upstream commit SHA");

const releaseNotes = fs.readdirSync(root)
  .filter((name) => /^release-notes-.*\.md$/.test(name))
  .sort();
assert.deepEqual(releaseNotes, ["release-notes-v4.0.1.md"],
  "only the maintained v4 release notes should remain in the repository");

for (const match of readme.matchAll(/\]\((?!https?:\/\/)([^)#]+)(?:#[^)]+)?\)/g)) {
  assert.equal(fs.existsSync(path.join(root, match[1])), true,
    `README local link must exist: ${match[1]}`);
}

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
