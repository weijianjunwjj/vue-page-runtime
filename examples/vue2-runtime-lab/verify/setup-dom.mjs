/**
 * jsdom 全局，必须在 vue 求值前就位。
 * Vue 2 在模块加载时计算 inBrowser = typeof window !== 'undefined'，
 * 若此时无 window 则永远走非浏览器分支、$mount 不真正 patch DOM。
 * 故本模块作为 headless.mjs 的第一个 import。
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/'
})
global.window = dom.window
global.document = dom.window.document
;['Element', 'Node', 'HTMLElement', 'SVGElement', 'DocumentFragment', 'Text',
  'Comment', 'Event', 'CustomEvent', 'MutationObserver'].forEach(function (k) {
  if (global[k] === undefined && dom.window[k] !== undefined) global[k] = dom.window[k]
})

export { dom }
