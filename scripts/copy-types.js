const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const srcFile = path.join(rootDir, 'src', 'index.d.ts');
const distDir = path.join(rootDir, 'dist');
const distFile = path.join(distDir, 'index.d.ts');

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(srcFile, distFile);

console.log('[types] copied src/index.d.ts to dist/index.d.ts');
