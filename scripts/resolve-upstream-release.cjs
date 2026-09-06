const { execFileSync } = require('node:child_process');

function latestDshRelease(releases) {
  const release = releases.filter((item) => !item.draft && item.published_at
    && /^dsh-v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(item.tag_name))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  if (!release) throw new Error('No published DSH release was found');
  return release.tag_name;
}

if (require.main === module) {
  const releases = JSON.parse(execFileSync('gh', ['api', 'repos/deepseek-ai/deepseek-harness/releases?per_page=100'], { encoding: 'utf8' }));
  process.stdout.write(latestDshRelease(releases) + '\n');
}
module.exports = { latestDshRelease };
