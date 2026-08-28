const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { patchReleaseProcess } = require("../scripts/patch-upstream-windows-release.cjs");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "upstream-sync.yml"),
  "utf8",
);
const verifier = fs.readFileSync(
  path.join(root, "scripts", "verify-installed-runtime.ps1"),
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(workflow, /workflow_dispatch:/, "the release pipeline needs a forceable acceptance run");
assert.match(workflow, /inputs\.force|inputs\.force|inputs:\s*[\s\S]*force:/);
assert.match(workflow, /push:\s*[\s\S]*branches:\s*\[main\][\s\S]*paths:/, "desktop-shell pushes must run acceptance without a manual dispatch");
const pushBlock = workflow.match(/push:\s*[\s\S]*?schedule:/)?.[0] || "";
assert.doesNotMatch(pushBlock, /package(?:-lock)?\.json|upstream-lock\.json/, "manual release-state commits must not retrigger packaging");
assert.match(workflow, /release-policy\.cjs/, "release decisions must use the tested state machine");
assert.match(workflow, /release\.outputs\.bump[\s\S]*npm version patch --no-git-tag-version/, "repair runs must reuse the existing version");
assert.match(workflow, /PSNativeCommandUseErrorActionPreference\s*=\s*\$true/, "native build failures must stop the workflow immediately");
assert.match(workflow, /patch-upstream-windows-release\.cjs[\s\S]*release:pack/, "Windows CI must patch upstream child-process resolution before packing");
assert.match(packageJson.scripts["build:installer"], /--publish\s+never/, "electron-builder must not publish before acceptance gates pass");
assert.match(workflow, /resources[\\/]app-update\.yml/, "the installed updater feed must be verified");
assert.match(workflow, /installer-dist[\\/]latest\.yml/, "release metadata must be checked before publish");
assert.match(workflow, /SHA512[\s\S]*ComputeHash[\s\S]*latest\.yml/, "the installer hash must match release metadata");
assert.match(workflow, /installer_sha256[\s\S]*SHA256/, "acceptance must calculate a human-verifiable installer checksum");
assert.match(workflow, /version -eq '2\.1\.0'\) \{ 'v2\.1' \}/, "release inspection must preserve historical tag mapping");
assert.match(workflow, /upstream-lock\.json[\s\S]*release\.outputs\.sha/, "the packaged runtime lock must match the selected upstream commit");
assert.match(verifier, /VersionInfo[\s\S]*FileVersion/, "the installed executable version must match the release");
assert.match(verifier, /Get-StartApps[\s\S]*com\.deepseek\.dsh/, "the installed shortcut AppID must own notifications");
assert.match(verifier, /for \(\$attempt = 0; \$attempt -lt 10; \$attempt\+\+\)[\s\S]*Get-StartApps[\s\S]*Start-Sleep -Seconds 1/, "Start Menu registration must be polled to avoid an indexing race");
assert.match(verifier, /portReleased|Port 3080 remained open/, "process cleanup must prove the backend port closed");
assert.match(workflow, /release download[\s\S]*latest\.yml[\s\S]*publishedMetadata/, "existing release metadata must be inspected before a no-op");
assert.match(verifier, /RUNNER_TEMP[\s\S]*\/D=/, "CI installation must be isolated under the runner temporary directory");
assert.match(verifier, /GetTempPath/, "local release acceptance must fall back safely when RUNNER_TEMP is unavailable");
assert.match(verifier, /try\s*\{[\s\S]*finally\s*\{/, "runtime cleanup must run even after an acceptance failure");
assert.match(verifier, /7-Zip rejected[\s\S]*try\s*\{[\s\S]*Start-Process \$installerPath[\s\S]*finally\s*\{/, "installer failures must also enter the cleanup boundary");
assert.match(verifier, /--version[\s\S]*ExpectedRuntimeVersion/, "the installed Harness CLI version must match the upstream lock");
assert.match(verifier, /ELECTRON_RUN_AS_NODE[\s\S]*electron-node-runtime-probe\.cjs/,
  "installed acceptance must exercise the slim Electron Node runtime");
assert.match(verifier, /node-pty[\s\S]*sharp[\s\S]*koffi/,
  "installed acceptance must load every shipped native addon through Electron Node");
assert.match(verifier, /Uninstall[\s\S]*\/S/, "the CI-installed app must pass a silent uninstall check");
assert.match(workflow, /permissions:\s*[\s\S]*contents:\s*read/, "Actions must be read-only for repository contents");
assert.doesNotMatch(workflow, /github-actions\[bot\]|git push|gh release (?:create|upload|edit)/i,
  "release state and assets must be submitted manually by Links2008, never by a bot");
assert.doesNotMatch(workflow, /attest-build-provenance|attestations:\s*write|id-token:\s*write/i,
  "the read-only validation bot must not publish attestations");
assert.doesNotMatch(workflow, /OPENAI_API_KEY|api\.openai\.com|@Codex/i, "automatic packaging must not call GPT or consume Codex quota");

const upstreamProcessFixture = `
const captured = spawnSync(command, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8' })
const echoed = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  })
const inherited = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'inherit' })
`;
const patchedUpstream = patchReleaseProcess(upstreamProcessFixture);
assert.equal(patchedUpstream.changed, true);
assert.equal((patchedUpstream.source.match(/shell: process\.platform === 'win32'/g) || []).length, 3);
assert.equal(patchReleaseProcess(patchedUpstream.source).changed, false, "the patch must be idempotent");
assert.throws(
  () => patchReleaseProcess("spawnSync(command, args, {})"),
  /upstream release process shape changed/,
  "an upstream refactor must fail closed instead of silently skipping the compatibility patch",
);

console.log("update pipeline behavior verified");
