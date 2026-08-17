function decideRelease(input = {}) {
  const currentReleaseReady = input.currentReleaseReady === true;
  if (!currentReleaseReady) {
    return { shouldBuild: true, bump: false, reason: "repair-release" };
  }
  if (input.upstreamChanged === true) {
    return { shouldBuild: true, bump: true, reason: "upstream-change" };
  }
  if (input.desktopPush === true) {
    // 作者已在提交里手动 bump 版本（如 v2.2.0）时不再二次 bump，
    // 保证发布 tag 与作者声明的版本一致。
    return { shouldBuild: true, bump: input.authorBumped !== true, reason: "desktop-change" };
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
