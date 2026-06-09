/**
 * jsdom DOM 全局，必须在 vue 模块被求值之前就位。
 * ESM 按 import 文本顺序深度求值：把本模块作为 smoke.mjs 的第一个 import，
 * 即可保证 global.document 在 `import 'vue'` 求值前已设置（否则 runtime-dom
 * 在模块顶层捕获的 document 为 undefined）。
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>')
global.window = dom.window
global.document = dom.window.document
;['SVGElement', 'Element', 'Node', 'HTMLElement', 'DocumentFragment', 'Text',
  'Comment', 'Event', 'CustomEvent', 'MutationObserver'].forEach(function (k) {
  if (global[k] === undefined && dom.window[k] !== undefined) global[k] = dom.window[k]
})

export { dom }
