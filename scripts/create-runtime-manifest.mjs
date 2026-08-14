import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [runtimeRoot, ...tarballRoots] = process.argv.slice(2)
if (!runtimeRoot || tarballRoots.length === 0) {
  throw new Error('usage: node create-runtime-manifest.mjs <runtime-root> <tarball-dir> [...]')
}

const dependencies = {}
for (const tarballRoot of tarballRoots) {
  for (const filename of readdirSync(tarballRoot).filter(name => name.endsWith('.tgz')).sort()) {
    const tarball = resolve(tarballRoot, filename)
    const manifestText = execFileSync('tar.exe', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })
    const manifest = JSON.parse(manifestText)
    if (typeof manifest.name !== 'string' || manifest.name === '') {
      throw new Error(`${tarball} has no package name`)
    }
    dependencies[manifest.name] = pathToFileURL(tarball).href
  }
}

mkdirSync(runtimeRoot, { recursive: true })
writeFileSync(join(runtimeRoot, 'package.json'), `${JSON.stringify({
  name: 'deepseek-harness-desktop-runtime',
  version: '1.0.0',
  private: true,
  dependencies,
}, null, 2)}\n`)
console.log(`runtime manifest: ${Object.keys(dependencies).length} local tarballs`)
