import assert from 'node:assert/strict'

import { resolveLocalClosure } from '../scripts/create-runtime-manifest.mjs'

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

console.log('runtime manifest dependency closure verified')
