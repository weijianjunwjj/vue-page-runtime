import terser from '@rollup/plugin-terser';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const banner = `/*!
 * vue-page-runtime v${pkg.version}
 * (c) ${new Date().getFullYear()} weijianjun
 * @license MIT
 */`;

const globals = {
  vue: 'Vue',
  'vue-page-store': 'VuePageStore',
};

export default {
  input: 'src/index.js',
  external: Object.keys(pkg.peerDependencies || {}),
  output: [
    {
      file: 'dist/index.esm.js',
      format: 'es',
      banner,
    },
    {
      file: 'dist/index.mjs',
      format: 'es',
      banner,
    },
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      exports: 'default',
      banner,
    },
    {
      file: 'dist/index.cjs',
      format: 'cjs',
      exports: 'default',
      banner,
    },
    {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'VuePageRuntime',
      exports: 'default',
      globals,
      banner,
    },
    {
      file: 'dist/index.umd.min.js',
      format: 'umd',
      name: 'VuePageRuntime',
      exports: 'default',
      globals,
      banner,
      plugins: [terser()],
    },
  ],
};
