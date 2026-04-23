const assert = require('node:assert/strict')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const pkg = require(path.join(rootDir, 'package.json'))

async function main () {
  const cjsPlugin = require(pkg.name)

  assert.equal(cjsPlugin.name, 'tasks')
  assert.equal(typeof cjsPlugin.install, 'function')
  assert.equal(typeof cjsPlugin.create, 'function')

  const esmModule = await import(pkg.name)
  const esmPlugin = esmModule.default

  assert.equal(esmPlugin.name, 'tasks')
  assert.equal(typeof esmPlugin.install, 'function')
  assert.equal(typeof esmPlugin.create, 'function')

  console.log('[smoke] require/import both resolved correctly')
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
