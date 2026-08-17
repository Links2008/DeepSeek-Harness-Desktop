const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { decideRelease } = require("../scripts/release-policy.cjs");

const ready = { currentReleaseReady: true };

assert.deepEqual(decideRelease(ready), {
  shouldBuild: false,
  bump: false,
  reason: "already-current",
});
assert.deepEqual(decideRelease({ ...ready, upstreamChanged: true }), {
  shouldBuild: true,
  bump: true,
  reason: "upstream-change",
});
assert.deepEqual(decideRelease({ ...ready, desktopPush: true }), {
  shouldBuild: true,
  bump: true,
  reason: "desktop-change",
});
assert.deepEqual(decideRelease({ ...ready, desktopPush: true, authorBumped: true }), {
  shouldBuild: true,
  bump: false,
  reason: "desktop-change",
});
assert.deepEqual(decideRelease({ ...ready, force: true }), {
  shouldBuild: true,
  bump: true,
  reason: "forced",
});

for (const trigger of [
  {},
  { upstreamChanged: true },
  { desktopPush: true },
  { force: true },
]) {
  assert.deepEqual(decideRelease({ ...trigger, currentReleaseReady: false }), {
    shouldBuild: true,
    bump: false,
    reason: "repair-release",
  });
}

const script = path.resolve(__dirname, "..", "scripts", "release-policy.cjs");
const cli = spawnSync(process.execPath, [script, JSON.stringify({ ...ready, desktopPush: true })], {
  encoding: "utf8",
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /^should_build=true$/m);
assert.match(cli.stdout, /^bump=true$/m);
assert.match(cli.stdout, /^reason=desktop-change$/m);

console.log("release policy verified");
