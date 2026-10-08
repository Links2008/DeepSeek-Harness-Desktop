import assert from 'node:assert/strict'

import { createRuntimeManifest, resolveLocalClosure } from '../scripts/create-runtime-manifest.mjs'

const packages = new Map([
  ['@deepseek-ai/dsh', { manifest: {
    name: '@deepseek-ai/dsh',
    dependencies: { '@deepseek-ai/dsh-base': '1.0.0', external: '^1.0.0' },
  } }],
  ['@deepseek-ai/dsh-base', { manifest: {
    name: '@deepseek-ai/dsh-base',
    dependencies: { '@deepseek-ai/dsh-web-app': '1.0.0' },
    optionalDependencies: { '@vendor/native': '1.0.0' },
    peerDependencies: { '@vendor/peer': '1.0.0', '@vendor/optional-peer': '1.0.0' },
    peerDependenciesMeta: { '@vendor/optional-peer': { optional: true } },
  } }],
  ['@deepseek-ai/dsh-web-app', { manifest: { name: '@deepseek-ai/dsh-web-app' } }],
  ['@vendor/native', { manifest: { name: '@vendor/native' } }],
  ['@vendor/peer', { manifest: { name: '@vendor/peer' } }],
  ['@vendor/optional-peer', { manifest: { name: '@vendor/optional-peer' } }],
  ['@deepseek-ai/dsh-subagent-codex', { manifest: {
    name: '@deepseek-ai/dsh-subagent-codex',
    dependencies: { '@openai/codex': '1.0.0' },
  } }],
  ['@openai/codex', { manifest: { name: '@openai/codex' } }],
])

assert.deepEqual(
  [...resolveLocalClosure(packages, ['@deepseek-ai/dsh'])].sort(),
  [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@vendor/native',
    '@vendor/peer',
  ],
)

assert.throws(
  () => resolveLocalClosure(packages, ['@deepseek-ai/missing']),
  /runtime root package is missing/,
)

// Match the prerelease host versions that dshmarket's stable peer ranges reject.
const dependencies = Object.freeze({
  '@deepseek-ai/dsh-settings': 'file:///C:/packed-dsh/deepseek-ai-dsh-settings-0.2.1-alpha.1.tgz',
  '@deepseek-ai/cordis': 'file:///C:/packed-vendor/deepseek-ai-cordis-4.0.5-alpha.1.tgz',
  '@deepseek-ai/schemastery': 'file:///C:/packed-vendor/deepseek-ai-schemastery-3.18.5-alpha.1.tgz',
  '@deepseek-ai/dsh': 'file:///C:/packed-dsh/deepseek-ai-dsh-0.2.1-alpha.1.tgz',
})
const runtime = createRuntimeManifest(dependencies)
assert.deepEqual(runtime.dependencies, { ...dependencies, dshmarket: '1.57.0' },
  'the runtime must keep the exact local host tarballs and pinned store version')
assert.notEqual(runtime.dependencies, dependencies, 'manifest generation must not mutate its input')
assert.deepEqual(runtime.overrides, { dshmarket: {
  '@deepseek-ai/dsh-settings': '$@deepseek-ai/dsh-settings',
  '@deepseek-ai/cordis': '$@deepseek-ai/cordis',
  '@deepseek-ai/schemastery': '$@deepseek-ai/schemastery',
} }, 'only dshmarket may override these peers, using the host dependency specs')
for (const [name, reference] of Object.entries(runtime.overrides.dshmarket)) {
  assert.equal(reference, `$${name}`)
  assert.ok(runtime.dependencies[name], `the ${name} override must refer to a runtime dependency`)
}

console.log('runtime manifest dependency closure and store peer alignment verified')
