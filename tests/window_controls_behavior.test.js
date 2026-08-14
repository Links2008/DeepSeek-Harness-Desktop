const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.resolve(__dirname, "..", "window-controls.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "window controls must contain an executable script");

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  add(name) {
    this.names.add(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }
}

function runControls({ reducedMotion = false } = {}) {
  const listeners = new Map();
  const timers = [];
  const calls = [];
  const classList = new FakeClassList();
  const button = {
    classList,
    dataset: { action: "max" },
    setPointerCapture() {},
  };
  const controls = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const sandbox = {
    document: { querySelector: () => controls },
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
    window: {
      dshWin: {
        max(options) {
          calls.push(options);
        },
      },
    },
  };

  vm.runInNewContext(script, sandbox);
  return { button, calls, listeners, timers };
}

const runtime = runControls();
const event = { pointerId: 7, target: { closest: () => runtime.button } };
assert.equal(typeof runtime.listeners.get("pointerdown"), "function", "feedback must start on pointerdown");
assert.equal(typeof runtime.listeners.get("pointerup"), "function", "release must have its own rebound state");
runtime.listeners.get("pointerdown")(event);
assert.equal(runtime.button.classList.contains("pressed"), true, "pointerdown must paint a pressed frame");
runtime.listeners.get("pointerup")(event);
assert.equal(runtime.button.classList.contains("pressed"), false);
assert.equal(runtime.button.classList.contains("releasing"), true, "pointerup must paint a rebound frame");
runtime.listeners.get("click")(event);

const actionTimer = runtime.timers
  .filter(({ delay }) => delay >= 0 && delay <= 120)
  .sort((a, b) => a.delay - b.delay)[0];
assert.ok(actionTimer, "the window action must follow the visible press without a sluggish delay");
actionTimer.callback();
assert.equal(runtime.calls.length, 1);
assert.equal(runtime.calls[0].reducedMotion, false);

const reduced = runControls({ reducedMotion: true });
reduced.listeners.get("click")({ target: { closest: () => reduced.button } });
const immediate = reduced.timers.filter(({ delay }) => delay === 0);
assert.ok(immediate.length > 0, "reduced motion must not add an animation delay");
for (const timer of immediate) timer.callback();
assert.equal(reduced.calls.length, 1);
assert.equal(reduced.calls[0].reducedMotion, true);

console.log("window controls behavior verified");
