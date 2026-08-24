import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [runtimeRoot, ...tarballRoots] = process.argv.slice(2)

export function resolveLocalClosure(packages, roots) {
  const selected = new Set()
  const pending = [...roots]
  for (const root of roots) {
    if (!packages.has(root)) throw new Error(`runtime root package is missing: ${root}`)
  }
  while (pending.length > 0) {
    const name = pending.shift()
    if (selected.has(name)) continue
    selected.add(name)
    const manifest = packages.get(name).manifest
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(manifest[field] || {})) {
        const optionalPeer = field === 'peerDependencies' && manifest.peerDependenciesMeta?.[dependency]?.optional === true
        if (!optionalPeer && packages.has(dependency) && !selected.has(dependency)) pending.push(dependency)
      }
    }
  }
  return selected
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!runtimeRoot || tarballRoots.length === 0) {
    throw new Error('usage: node create-runtime-manifest.mjs <runtime-root> <tarball-dir> [...]')
  }
  const packages = new Map()
  for (const tarballRoot of tarballRoots) {
    for (const filename of readdirSync(tarballRoot).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = resolve(tarballRoot, filename)
      const manifestText = execFileSync('tar.exe', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })
      const manifest = JSON.parse(manifestText)
      if (typeof manifest.name !== 'string' || manifest.name === '') throw new Error(`${tarball} has no package name`)
      if (packages.has(manifest.name)) throw new Error(`duplicate release package: ${manifest.name}`)
      packages.set(manifest.name, { manifest, tarball })
    }
  }
  const selected = resolveLocalClosure(packages, ['@deepseek-ai/dsh'])
  const dependencies = Object.fromEntries(
    [...selected].sort().map(name => [name, pathToFileURL(packages.get(name).tarball).href]),
  )
  mkdirSync(runtimeRoot, { recursive: true })
  writeFileSync(join(runtimeRoot, 'package.json'), `${JSON.stringify({
    name: 'deepseek-harness-desktop-runtime',
    version: '1.0.0',
    private: true,
    dependencies,
  }, null, 2)}\n`)
  console.log(`runtime manifest: ${selected.size}/${packages.size} local tarballs in the dsh runtime closure`)
}
