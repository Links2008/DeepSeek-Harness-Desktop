function decideRelease(input = {}) {
  const currentReleaseReady = input.currentReleaseReady === true;
  if (!currentReleaseReady) {
    return { shouldBuild: true, bump: false, reason: "repair-release" };
  }
  if (input.upstreamChanged === true) {
    return { shouldBuild: true, bump: true, reason: "upstream-change" };
  }
  if (input.desktopPush === true) {
    return { shouldBuild: true, bump: true, reason: "desktop-change" };
  }
  if (input.force === true) {
    return { shouldBuild: true, bump: true, reason: "forced" };
  }
  return { shouldBuild: false, bump: false, reason: "already-current" };
}

function parseInput(value) {
  if (!value) throw new Error("release-policy requires one JSON argument");
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("release-policy input must be a JSON object");
  }
  return parsed;
}

if (require.main === module) {
  try {
    const decision = decideRelease(parseInput(process.argv[2]));
    process.stdout.write([
      `should_build=${decision.shouldBuild}`,
      `bump=${decision.bump}`,
      `reason=${decision.reason}`,
    ].join("\n") + "\n");
  } catch (error) {
    process.stderr.write(`release-policy error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { decideRelease };
