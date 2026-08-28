const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const root = path.resolve(__dirname, "..");
const workflow = yaml.load(
  fs.readFileSync(path.join(root, ".github", "workflows", "upstream-sync.yml"), "utf8"),
);
const steps = Object.values(workflow.jobs || {}).flatMap((job) => job.steps || []);
const scripts = steps.filter((step) => step.shell === "pwsh" && typeof step.run === "string");

assert.ok(scripts.length >= 5, "expected every build and acceptance phase to expose a PowerShell script");
assert.equal(scripts.some((step) => /publish|commit the tested release/i.test(step.name)), false,
  "Actions must validate releases without publishing or committing as a bot");

for (const step of scripts) {
  const source = step.run.replace(/\$\{\{[\s\S]*?\}\}/g, "GITHUB_VALUE");
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  const check = [
    `$source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))`,
    "$tokens = $null",
    "$errors = $null",
    "[Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null",
    "if ($errors.Count) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", check],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.status, 0, `${step.name}: ${result.stderr || result.stdout}`);
}

console.log(`workflow PowerShell syntax verified (${scripts.length} steps)`);
