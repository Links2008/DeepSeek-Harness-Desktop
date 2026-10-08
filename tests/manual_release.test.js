const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts", "publish-release.ps1");
assert.equal(fs.existsSync(scriptPath), true, "a repeatable human release command must exist");

const script = fs.readFileSync(scriptPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "upstream-sync.yml"), "utf8");

assert.match(packageJson.scripts["release:github"], /publish-release\.ps1[\s\S]*-Publish/);
assert.match(script, /gh api user[\s\S]*Links2008/,
  "publishing must verify the authenticated human account");
assert.match(script, /\[bot\]|github-actions/i, "bot identities must be rejected explicitly");
assert.match(script, /git status --porcelain[\s\S]*Working tree must be clean/);
assert.match(script, /origin\/main[\s\S]*HEAD/, "the tagged commit must already be pushed to main");
assert.match(script, /actions\/workflows\/upstream-sync\.yml\/runs[\s\S]*conclusion[\s\S]*success/,
  "publishing must require a successful read-only validation run for the exact HEAD");
assert.match(script, /\.exe\.blockmap[\s\S]*latest\.yml/,
  "differential update metadata must be published with the installer");
assert.match(script, /SHA512[\s\S]*latest\.yml/i, "release metadata must match installer bytes");
assert.match(script, /releases\?per_page=100[\s\S]*existingRelease[\s\S]*no files were overwritten/i,
  "reruns must verify an existing release without overwriting it");
assert.match(script, /@\(\$releaseIndex\.tag_name\)\s*-contains\s*\$tag/,
  "Windows PowerShell must inspect the top-level release array without nesting it");
assert.match(script, /if \(\$existingRelease\)[\s\S]*return[\s\S]*Local tag \$tag does not point to HEAD/,
  "an already-published version must be verified before new-tag conflict checks");
assert.match(script, /\$notes = Join-Path \$root "release-notes-v\$version\.md"/,
  "each release must use its own versioned update notes");
assert.match(script, /if \(\$existingRelease\)[\s\S]*return\s*\}\s*\$pendingNotes = Join-Path \$root 'release-notes-unreleased\.md'[\s\S]*if \(Test-Path -LiteralPath \$pendingNotes\)\s*\{\s*throw[\s\S]*\$localTag =/,
  "pending notes must block new releases before tag changes, without blocking existing-release verification");
assert.match(script, /Move pending updates[\s\S]*release-notes-v\$version\.md[\s\S]*remove the pending file/,
  "the release guard must explain how to carry pending updates into the actual release notes");
assert.match(script, /releases\/latest[\s\S]*latest\.tag_name/,
  "Latest verification must use stable REST API fields");
assert.doesNotMatch(script, /isLatest/, "verification must not depend on a gh-version-specific field");
assert.match(script, /\.digest[\s\S]*sha256:/i, "published installer digest must match the local artifact");
assert.match(script, /release create[\s\S]*--verify-tag[\s\S]*--latest/,
  "the human release command must publish only an existing verified tag as Latest");
assert.match(script, /release create[^\r\n]*--notes-file \$notes/,
  "GitHub Release creation must include the versioned update notes");
assert.doesNotMatch(workflow, /gh release (?:create|upload|edit)|contents:\s*write/i,
  "Actions must remain a read-only acceptance gate");
assert.match(workflow, /github\.event_name[^\n]*schedule[\s\S]*resolve-upstream-release\.cjs[\s\S]*\$lock\.commit/,
  "scheduled monitoring must follow published releases while release builds stay pinned");
assert.match(workflow, /ref:\s*\$\{\{\s*steps\.upstream\.outputs\.ref\s*\}\}/,
  "release commits must build the exact runtime revision from upstream-lock.json");
assert.match(workflow, /upstream_ref:[\s\S]*default: ""[\s\S]*type: string/,
  "manual compatibility checks must be able to select the failing upstream revision explicitly");
assert.match(workflow, /UPSTREAM_REF: \$\{\{ inputs\.upstream_ref \}\}/,
  "the manual upstream ref must be passed as data instead of interpolated into PowerShell");
assert.match(workflow, /elseif \('[^'\n]*github\.event_name[^'\n]*' -eq 'workflow_dispatch' -and \$env:UPSTREAM_REF\)[\s\S]*\$ref = \$env:UPSTREAM_REF\.Trim\(\)/,
  "only an explicit manual input may override the locked revision outside scheduled monitoring");

console.log("manual human release contract verified");
