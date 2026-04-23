const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const srcFile = path.join(rootDir, 'src', 'index.js')
const distDir = path.join(rootDir, 'dist')
const esmFile = path.join(distDir, 'index.mjs')
const cjsFile = path.join(distDir, 'index.cjs')

const marker = 'export default defaultPlugin'
const banner = '// Generated from src/index.js. Do not edit directly.\n'

const source = fs.readFileSync(srcFile, 'utf8')

if (!source.includes(marker)) {
  throw new Error('Build failed: missing export marker in src/index.js')
}

const cjsSource = source.replace(
  marker,
  [
    'module.exports = defaultPlugin',
    'module.exports.default = defaultPlugin',
    'module.exports.create = createPlugin'
  ].join('\n')
)

fs.mkdirSync(distDir, { recursive: true })
fs.writeFileSync(esmFile, banner + source, 'utf8')
fs.writeFileSync(cjsFile, banner + cjsSource, 'utf8')

console.log('[build] wrote dist/index.mjs and dist/index.cjs')
