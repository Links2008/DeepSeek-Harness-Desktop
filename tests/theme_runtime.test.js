const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { patchTheme, patchHarnessRuntime } = require('../scripts/patch-harness-runtime.cjs');

// 与正式文件补丁一致，先统一 Windows 检出时的 CRLF 换行。
const readSource = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fixtures = [
  {
    label: 'alpha.2', file: 'theme-alpha2.js.txt', operation: 'this.host.set(field, value)',
    anchors: [
      'write(field, value) {',
      'if (isThemePreference(id)) this.write(THEME_PREFERENCE_FIELD, id);',
      'this.write(spec.field, px);',
      'this.write(FONT_FAMILY_FIELDS[role], list);',
    ],
  },
  {
    label: 'rc.2', file: 'theme-rc2.js.txt', operation: 'operation()',
    anchors: [
      'write(operation) {',
      'if (isThemePreference(id)) this.write(() => this.host.set(THEME_PREFERENCE_FIELD, id));',
      'this.write(() => this.host.set(spec.field, px));',
      'this.write(() => this.host.set(FONT_FAMILY_FIELDS[role], list));',
      'this.write(() => this.host.mutate(ops));',
    ],
  },
].map((fixture) => ({ ...fixture, source: readSource(path.join(__dirname, 'fixtures', fixture.file)) }));
for (const { label, source, operation, anchors } of fixtures) {
  const patched = patchTheme(source);
  assert.ok(patched.includes(`${operation}.then(settle, settle);`), `${label}：传输拒绝必须收尾且不泄漏 Promise`);
  assert.doesNotMatch(patched, /pendingPreference|writeSequence/, `${label}：保留上游的写入顺序实现`);
  assert.equal(patchTheme(patched), patched, `${label}：重复补丁必须幂等`);
  for (const anchor of [
    ...anchors, 'pendingWrites = 0;', 'this.pendingWrites += 1;', '.finally(() => {',
    'this.pendingWrites -= 1;', 'this.adopt();', 'if (this.pendingWrites > 0) return;',
    'const section = this.host.getSnapshot().value;',
  ]) {
    assert.throws(() => patchTheme(source.replace(anchor, '/* changed upstream */')),
      /upstream anchor changed/, `${label}：缺失 ${anchor} 时仍须阻断构建`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-native-theme-'));
  try {
    const file = path.join(temporary, 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const failures = [];
    fs.writeFileSync(file, source.replace(/\n/g, '\r\n'));
    assert.deepEqual(patchHarnessRuntime(temporary, null, { onFailure: (message) => failures.push(message) }), ['theme'],
      `${label}：正式文件入口必须先统一 Windows 换行再应用补丁`);
    assert.deepEqual(failures, []);
    assert.equal(fs.readFileSync(file, 'utf8'), patched);
    assert.deepEqual(patchHarnessRuntime(temporary, null, { onFailure: (message) => failures.push(message) }), []);
    const malformed = source.replace('this.pendingWrites -= 1;', '');
    fs.writeFileSync(file, malformed);
    patchHarnessRuntime(temporary, null, { onFailure: (message) => failures.push(message) });
    assert.equal(failures.length, 1, `${label}：不完整的上游结构必须通过回调报告失败`);
    assert.match(failures[0], /theme upstream write settlement: upstream anchor changed/);
    assert.equal(fs.readFileSync(file, 'utf8'), malformed, `${label}：识别失败不得写入半成品补丁`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// The offline fixture executes the published setter/write/adopt methods. Only
// their registry, snapshot and font collaborators are supplied by this harness.
function excerptRuntime(source) {
  const context = {
    THEME_PREFERENCE_FIELD: 'preference',
    FONT_ROLES: ['text', 'code', 'terminal'],
    FONT_SIZE_SPECS: {
      text: { field: 'fontSize', min: 10, max: 22 },
      code: { field: 'codeFontSize', min: 10, max: 16 },
      terminal: { field: 'terminalFontSize', min: 10, max: 20 },
    },
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
  const enqueue = (operation) => {
    const deferred = Promise.withResolvers();
    writes.push({ ...operation, ...deferred });
    return deferred.promise;
  };
  const host = {
    getSnapshot: () => ({ value: section }),
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    set(field, value) { return enqueue({ field, value }); },
    mutate(ops) { return enqueue({ ops }); },
  };
  const theme = new Runtime({
    effect(callback) { disposers.push(callback()); },
    emit(_event, snapshot) { events.push(snapshot); },
    // 可选快捷键服务未挂载；仍提供 rc.2 构造器所需的上下文注入接口。
    inject() {},
  }, host);
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
async function verifyFontSizeMutation(Runtime, label) {
  const batch = make(Runtime);
  const initialEvents = batch.events.length;
  assert.equal(typeof batch.theme.adjustFontSizes, 'function', `${label}：必须保留上游的批量字体修改`);
  batch.theme.adjustFontSizes(1);
  assert.equal(batch.events.length, initialEvents + 1, `${label}：批量修改只发布一次主题事件`);
  assert.equal(batch.writes.length, 1, `${label}：三个字号必须通过同一次 mutation 保存`);
  assert.deepEqual(JSON.parse(JSON.stringify(batch.writes[0].ops)), [
    { op: 'set', path: ['fontSize'], value: 15 },
    { op: 'set', path: ['codeFontSize'], value: 12 },
    { op: 'set', path: ['terminalFontSize'], value: 14 },
  ]);
  batch.theme.setTheme('dark');
  batch.publish({ preference: 'light' });
  await batch.settle(1);
  assert.equal(batch.theme.getTheme().preference, 'dark', `${label}：字段写入先结束时，批量写入仍保护本地状态`);
  assert.equal(batch.theme.getTheme().fontSizes.code, 12);
  batch.publish({ preference: 'dark', fontSize: 15, codeFontSize: 12, terminalFontSize: 14, terminalFontFamily: 'monospace' });
  await batch.settle(0);
  assert.equal(batch.theme.getTheme().fontFamilies.terminal, 'monospace', `${label}：最后一次 mutation 结束后采纳全部持久化字段`);
  assert.equal(batch.writes.length, 2, `${label}：采纳状态不能重复保存`);
  batch.dispose();

  const rejected = make(Runtime);
  rejected.theme.adjustFontSizes(1);
  rejected.theme.adjustFontSizes(1);
  rejected.publish({ preference: 'dark', fontSize: 12, codeFontSize: 10, terminalFontSize: 12 });
  await rejected.reject(0);
  assert.equal(rejected.theme.getTheme().fontSizes.text, 16, `${label}：较早的 mutation 被拒绝不能解除较新的写入保护`);
  await rejected.reject(1);
  assert.equal(rejected.theme.getTheme().fontSizes.text, 12, `${label}：全部 mutation 拒绝后必须恢复持久化状态`);
  assert.equal(rejected.theme.getTheme().preference, 'dark');
  rejected.theme.adjustFontSizes(1);
  rejected.publish({ preference: 'dark', fontSize: 13, codeFontSize: 11, terminalFontSize: 13 });
  await rejected.settle(2);
  assert.equal(rejected.theme.getTheme().fontSizes.text, 13, `${label}：传输恢复后可再次批量保存`);
  rejected.dispose();

  const refused = make(Runtime);
  refused.theme.adjustFontSizes(1);
  refused.publish({ fontSize: 12, codeFontSize: 10, terminalFontSize: 12 });
  await refused.settle(0, false);
  assert.equal(refused.theme.getTheme().fontSizes.text, 12, `${label}：Host 拒绝 mutation 时须采纳恢复后的状态`);
  refused.dispose();

  const limits = make(Runtime);
  limits.publish({ fontSize: 22, codeFontSize: 15, terminalFontSize: 20 });
  limits.theme.adjustFontSizes(1);
  assert.deepEqual(JSON.parse(JSON.stringify(limits.writes[0].ops)), [
    { op: 'set', path: ['codeFontSize'], value: 16 },
  ], `${label}：已达上限的角色不得写入 mutation`);
  limits.publish({ fontSize: 22, codeFontSize: 16, terminalFontSize: 20 });
  await limits.settle(0);
  const upperEvents = limits.events.length;
  limits.theme.adjustFontSizes(1);
  assert.equal(limits.writes.length, 1, `${label}：全部达到上限时不保存`);
  assert.equal(limits.events.length, upperEvents, `${label}：全部达到上限时不发布事件`);
  limits.publish({ fontSize: 10, codeFontSize: 10, terminalFontSize: 10 });
  const lowerEvents = limits.events.length;
  limits.theme.adjustFontSizes(-1);
  assert.equal(limits.writes.length, 1, `${label}：全部达到下限时不保存`);
  assert.equal(limits.events.length, lowerEvents, `${label}：全部达到下限时不发布事件`);
  limits.dispose();
}
(async () => {
  for (const { label, source } of fixtures) {
    const Runtime = excerptRuntime(patchTheme(source));
    await verifyBehavior(Runtime, `${label} fixture`);
    if (label === 'rc.2') await verifyFontSizeMutation(Runtime, `${label} fixture`);
  }
  const bundled = process.env.DSH_THEME_BUNDLE || path.join(__dirname, '..', 'bundle', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js');
  if (process.env.DSH_THEME_BUNDLE || fs.existsSync(bundled)) {
    const source = readSource(bundled);
    const patched = patchTheme(source);
    if (source.includes('pendingWrites = 0;')) {
      assert.equal(patchTheme(patched), patched, 'the built upstream bundle must retain an idempotent adaptation');
      const Runtime = bundledRuntime(patched);
      await verifyBehavior(Runtime, 'built upstream bundle');
      if (typeof Runtime.prototype.adjustFontSizes === 'function') await verifyFontSizeMutation(Runtime, 'built upstream bundle');
      console.log('built upstream theme write/adoption behavior verified');
    }
  }
  await new Promise(setImmediate);
  console.log('theme write/adoption compatibility and failure gates verified');
})().catch((error) => { console.error(error); process.exitCode = 1; });
