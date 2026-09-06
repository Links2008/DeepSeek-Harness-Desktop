const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const start = main.indexOf('async function injectDesktopTweaks() {');
const end = main.indexOf('\nasync function ', start + 1);
assert.ok(start >= 0 && end > start, 'desktop injection function must be found');
const styles = [];
const context = {
  mainWindow: {
    isDestroyed: () => false,
    webContents: {
      insertCSS: async (css) => { styles.push(css); },
      executeJavaScript: async () => {},
    },
  },
};
vm.runInNewContext(main.slice(start, end) + '\ninjectDesktopTweaks()', context)
  .then(() => {
    assert.ok(styles.length, 'test must inspect the actual injected CSS');
    assert.doesNotMatch(styles.join('\n'), /[^{}]*_boot_[^{}]*\{[^}]*display\s*:\s*none/i,
      'the upstream boot container also renders plugin failures and must stay visible');
    console.log('startup error visibility verified');
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
