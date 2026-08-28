const fs = require("node:fs");
const path = require("node:path");

const replacements = [
  {
    label: "captured command",
    before: "spawnSync(command, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8' })",
    after: "spawnSync(command, [...args], { shell: process.platform === 'win32', cwd: options.cwd, env: options.env, encoding: 'utf8' })",
  },
  {
    label: "echoed command",
    before: "spawnSync(command, [...args], {\n    cwd: options.cwd,\n    env: options.env,\n    encoding: 'utf8',\n    stdio: ['inherit', 'pipe', 'pipe'],\n  })",
    after: "spawnSync(command, [...args], {\n    shell: process.platform === 'win32',\n    cwd: options.cwd,\n    env: options.env,\n    encoding: 'utf8',\n    stdio: ['inherit', 'pipe', 'pipe'],\n  })",
  },
  {
    label: "concurrent inherited command",
    before: "spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'inherit' })",
    after: "spawn(command, [...args], { shell: process.platform === 'win32', cwd: options.cwd, env: options.env, stdio: 'inherit' })",
  },
];

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function patchReleaseProcess(source) {
  if (typeof source !== "string") throw new TypeError("release process source must be a string");
  let patched = source;
  let changed = false;

  for (const replacement of replacements) {
    const beforeCount = countOccurrences(patched, replacement.before);
    const afterCount = countOccurrences(patched, replacement.after);
    if (beforeCount === 1 && afterCount === 0) {
      patched = patched.replace(replacement.before, replacement.after);
      changed = true;
      continue;
    }
    if (beforeCount === 0 && afterCount === 1) continue;
    throw new Error(`upstream release process shape changed for ${replacement.label}`);
  }

  return { source: patched, changed };
}

function patchFile(filePath) {
  const resolved = path.resolve(filePath);
  const result = patchReleaseProcess(fs.readFileSync(resolved, "utf8"));
  if (result.changed) fs.writeFileSync(resolved, result.source, "utf8");
  return result;
}

if (require.main === module) {
  try {
    const target = process.argv[2];
    if (!target) throw new Error("upstream release process path is required");
    const result = patchFile(target);
    process.stdout.write(`${result.changed ? "Patched" : "Already compatible"}: ${target}\n`);
  } catch (error) {
    process.stderr.write(`Windows release compatibility patch failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { patchReleaseProcess, patchFile };
