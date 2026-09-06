const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { loadWindowState, trackWindowState, restoreWindowBounds } = require('../runtime/window-state.cjs');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-window-state-'));
const file = path.join(temporary, 'bounds.json');
const primary = { x: 0, y: 0, width: 1366, height: 728 };
const secondary = { x: -1920, y: 0, width: 1920, height: 1040 };
const screen = {
  getPrimaryDisplay: () => ({ workArea: primary }),
  getDisplayMatching: (bounds) => ({ workArea: bounds.x < 0 ? secondary : primary }),
};
try {
  let measured;
  let adjustments = 0;
  const scaledWindow = {
    setBounds: (bounds) => { adjustments += 1; measured = { ...bounds, width: bounds.width + 2, height: bounds.height + 1 }; },
    getNormalBounds: () => measured,
  };
  const target = { x: 20, y: 20, width: 958, height: 648 };
  restoreWindowBounds(scaledWindow, target);
  assert.deepEqual(measured, target, 'DPI frame deltas must not accumulate on reopen');
  assert.equal(adjustments, 2);
  restoreWindowBounds(scaledWindow, { width: 1280, height: 860 });
  assert.equal(adjustments, 2, 'unsaved default bounds are not moved');
  assert.deepEqual(loadWindowState(file, screen), { width: 1280, height: 728, maximized: false });
  fs.writeFileSync(file, '{invalid');
  assert.equal(loadWindowState(file, screen).width, 1280);
  fs.writeFileSync(file, JSON.stringify({ x: 9000, y: 3000, width: 2200, height: 1200, maximized: true }));
  assert.deepEqual(loadWindowState(file, screen), { ...primary, maximized: true });
  fs.writeFileSync(file, JSON.stringify({ x: -1800, y: 70, width: 900, height: 700, maximized: false }));
  assert.equal(loadWindowState(file, screen).x, -1800);
  fs.writeFileSync(file, JSON.stringify({ x: 10, y: 10, width: -1, height: 600 }));
  assert.equal(loadWindowState(file, screen).width, 1280);
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isMinimized = () => false;
  window.isMaximized = () => true;
  window.getNormalBounds = () => ({ x: 45, y: 60, width: 1000, height: 650 });
  trackWindowState(window, file);
  window.emit('resize');
  window.emit('close');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { x: 45, y: 60, width: 1000, height: 650, maximized: true });
  window.isMinimized = () => true;
  window.getNormalBounds = () => ({ x: -32000, y: -32000, width: 1, height: 1 });
  window.emit('close');
  assert.equal(JSON.parse(fs.readFileSync(file)).width, 1000);
  window.emit('closed');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('window bounds persistence verified');
