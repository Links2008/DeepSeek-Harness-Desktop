const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { patchTheme, patchHarnessRuntime } = require('../scripts/patch-harness-runtime.cjs');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'theme-alpha2.js.txt'), 'utf8');
const patchedFixture = patchTheme(fixture);
assert.match(patchedFixture, /this\.host\.set\(field, value\)\.then\(settle, settle\)/, 'transport rejection must settle without an unhandled Promise');
assert.doesNotMatch(patchedFixture, /pendingPreference|writeSequence/, 'upstream ordering must not receive the legacy desktop implementation');
assert.equal(patchTheme(patchedFixture), patchedFixture, 'native ordering adaptation is idempotent');
for (const anchor of [
  'pendingWrites = 0;',
  'if (isThemePreference(id)) this.write(THEME_PREFERENCE_FIELD, id);',
  'this.write(spec.field, px);',
  'this.write(FONT_FAMILY_FIELDS[role], list);',
  'this.pendingWrites += 1;',
  '.finally(() => {',
  'this.pendingWrites -= 1;',
  'this.adopt();',
  'if (this.pendingWrites > 0) return;',
  'const section = this.host.getSnapshot().value;',
]) {
  assert.throws(() => patchTheme(fixture.replace(anchor, '/* changed upstream */')),
    /upstream anchor changed/, `missing ${anchor} must still fail the build gate`);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-native-theme-'));
try {
  const file = path.join(temporary, 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const malformed = fixture.replace('this.pendingWrites -= 1;', '');
  fs.writeFileSync(file, malformed);
  const failures = [];
  patchHarnessRuntime(temporary, null, { onFailure: (message) => failures.push(message) });
  assert.equal(failures.length, 1, 'incomplete native protection must reach the installer failure callback');
  assert.match(failures[0], /theme upstream write settlement: upstream anchor changed/);
  assert.equal(fs.readFileSync(file, 'utf8'), malformed, 'failed recognition must not write a partial patch');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

// The offline fixture executes the published setter/write/adopt methods. Only
// their registry, snapshot and font collaborators are supplied by this harness.
function excerptRuntime(source) {
  const context = {
    THEME_PREFERENCE_FIELD: 'preference',
    FONT_ROLES: ['text', 'code', 'terminal'],
    FONT_SIZE_SPECS: { text: { field: 'fontSize' }, code: { field: 'codeFontSize' }, terminal: { field: 'terminalFontSize' } },
    FONT_FAMILY_FIELDS: { text: 'textFontFamily', code: 'codeFontFamily', terminal: 'terminalFontFamily' },
    isThemePreference: (id) => ['system', 'light', 'dark'].includes(id),
    isFontSize: (_role, px) => Number.isInteger(px),
    normalizeFontFamily: (value) => value,
    durableFontFamilies: (section) => ({ text: section.textFontFamily, code: section.codeFontFamily, terminal: section.terminalFontFamily }),
    sectionFontSizes: (section) => ({ text: section.fontSize, code: section.codeFontSize, terminal: section.terminalFontSize }),
  };
  return vm.runInNewContext(`(class {
${source}
    constructor(ctx, host) {
      this.ctx = ctx; this.host = host; this.themes = [{ id: 'light' }, { id: 'dark' }];
      this.preference = 'system'; this.fontSizes = { text: 14, code: 11, terminal: 13 };
      this.fontFamilies = { text: '', code: '', terminal: '' };
      ctx.effect(() => host.subscribe(() => this.adopt()));
      this.adopt();
    }
    getTheme() { return { preference: this.preference, fontSizes: this.fontSizes, fontFamilies: this.fontFamilies }; }
    publish() { this.ctx.emit('theme/change', this.getTheme()); }
  })`, context);
}
function bundledRuntime(source) {
  let exports;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load({ factory }) { exports = factory(() => ({})); } } },
  });
  assert.equal(typeof exports.ThemeRuntime, 'function');
  return exports.ThemeRuntime;
}
const defaults = {
  preference: 'system', fontSize: 14, codeFontSize: 11, terminalFontSize: 13,
  textFontFamily: '', codeFontFamily: '', terminalFontFamily: '',
};
function make(Runtime) {
  let section = { ...defaults };
  const listeners = new Set();
  const disposers = [];
  const writes = [];
  const events = [];
  const host = {
    getSnapshot: () => ({ value: section }),
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    set(field, value) {
      const deferred = Promise.withResolvers();
      writes.push({ field, value, ...deferred });
      return deferred.promise;
    },
  };
  const theme = new Runtime({ effect(callback) { disposers.push(callback()); }, emit(_event, snapshot) { events.push(snapshot); } }, host);
  return {
    theme, writes, events,
    publish(changes) { section = { ...defaults, ...changes }; for (const listener of listeners) listener(); },
    async settle(index, accepted = true) { writes[index].resolve(accepted); await writes[index].promise; await Promise.resolve(); },
    async reject(index) { writes[index].reject(new Error("transport disconnected")); await writes[index].promise.catch(() => {}); await Promise.resolve(); },
    dispose() { for (const dispose of disposers) dispose(); assert.equal(listeners.size, 0); },
  };
}
async function verifyBehavior(Runtime, label) {
  const rapid = make(Runtime);
  rapid.theme.setTheme('dark');
  rapid.theme.setTheme('light');
  rapid.theme.setTheme('light');
  assert.equal(rapid.writes.length, 2, `${label}: identical clicks remain a no-op`);
  rapid.publish({ preference: 'dark' });
  assert.equal(rapid.theme.getTheme().preference, 'light', `${label}: an old echo must not revert the latest click`);
  await rapid.settle(0);
  assert.equal(rapid.theme.getTheme().preference, 'light', `${label}: an older settlement must not end newer protection`);
  rapid.publish({ preference: 'light', terminalFontSize: 17 });
  await rapid.settle(1);
  assert.equal(rapid.theme.getTheme().fontSizes.terminal, 17, `${label}: the final settlement adopts all durable fields`);
  rapid.publish({ preference: 'dark' });
  assert.equal(rapid.theme.getTheme().preference, 'dark', `${label}: subsequent external changes remain live`);
  rapid.dispose();

  const mixed = make(Runtime);
  mixed.theme.setTheme('dark');
  mixed.theme.setFontSize('code', 15);
  mixed.theme.setFontFamily('terminal', 'monospace');
  mixed.publish({ preference: 'dark', codeFontSize: 12 });
  await mixed.settle(1);
  await mixed.settle(0);
  assert.equal(mixed.theme.getTheme().fontSizes.code, 15, `${label}: font writes share the pending counter`);
  assert.equal(mixed.theme.getTheme().fontFamilies.terminal, 'monospace');
  mixed.publish({ preference: 'dark', codeFontSize: 15, terminalFontFamily: 'monospace', fontSize: 16 });
  await mixed.settle(2);
  assert.equal(mixed.theme.getTheme().fontSizes.text, 16);
  assert.equal(mixed.writes.length, 3, `${label}: adoption must never write the section back`);
  mixed.dispose();

  const refused = make(Runtime);
  refused.theme.setTheme('dark');
  refused.publish({ preference: 'light' });
  await refused.settle(0, false);
  assert.equal(refused.theme.getTheme().preference, 'light', `${label}: a Host-refused write adopts the recovered durable section`);
  refused.theme.setTheme('dark');
  refused.publish({ preference: 'dark' });
  await refused.settle(1);
  assert.equal(refused.theme.getTheme().preference, 'dark', `${label}: later writes still work after a refusal`);
  refused.dispose();

  const disconnected = make(Runtime);
  disconnected.theme.setTheme('dark');
  disconnected.theme.setFontSize('code', 15);
  disconnected.publish({ preference: 'light', codeFontSize: 12 });
  await disconnected.reject(0);
  assert.equal(disconnected.theme.getTheme().preference, 'dark', `${label}: rejection must not release a newer pending write`);
  await disconnected.reject(1);
  assert.equal(disconnected.theme.getTheme().preference, 'light', `${label}: all rejected writes must release the adoption fence`);
  assert.equal(disconnected.theme.getTheme().fontSizes.code, 12);
  disconnected.theme.setTheme('dark');
  disconnected.publish({ preference: 'dark' });
  await disconnected.settle(2);
  assert.equal(disconnected.theme.getTheme().preference, 'dark', `${label}: reconnect can save again after rejected transport`);
  disconnected.dispose();
}
(async () => {
  await verifyBehavior(excerptRuntime(patchedFixture), 'alpha2 fixture');
  const bundled = process.env.DSH_THEME_BUNDLE || path.join(__dirname, '..', 'bundle', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js');
  if (process.env.DSH_THEME_BUNDLE || fs.existsSync(bundled)) {
    const source = fs.readFileSync(bundled, 'utf8');
    const patched = patchTheme(source);
    if (source.includes('pendingWrites = 0;')) {
      assert.equal(patchTheme(patched), patched, 'the built upstream bundle must retain an idempotent adaptation');
      await verifyBehavior(bundledRuntime(patched), 'built upstream bundle');
      console.log('built upstream theme write/adoption behavior verified');
    }
  }
  console.log('theme write/adoption compatibility and failure gates verified');
})().catch((error) => { console.error(error); process.exitCode = 1; });
