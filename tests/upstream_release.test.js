const assert = require('node:assert/strict');
const { latestDshRelease } = require('../scripts/resolve-upstream-release.cjs');
assert.equal(latestDshRelease([
  { tag_name: 'dsh-v0.1.2-rc.1', published_at: '2026-09-03', prerelease: true },
  { tag_name: 'dsh-v0.1.3-alpha.1', published_at: '2026-09-04', prerelease: true },
  { tag_name: 'dsh-v0.1.4', published_at: '2026-09-05', draft: true },
  { tag_name: 'vendor-v4.0.0', published_at: '2026-09-06' },
]), 'dsh-v0.1.3-alpha.1');
assert.throws(() => latestDshRelease([]), /No published DSH release/);
console.log('published upstream release selection verified');
