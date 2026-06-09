/**
 * 阶段 3 自检 —— host 适配后的"真触发"验证
 *
 * 阶段 1 的 59 assertion 证明"没炸"（行为不变）。本文件证明两处适配
 * 真正生效，而不是改了看不见的东西：
 *
 *   SC1  3.4 同名冲突检测被激活：task 与 action 同名 → dev warn 触发一次
 *        （旧代码读 store.$options，真实 host 无此属性 → 永不触发；
 *         现在读 typeof host[key] → 真活了）
 *   SC2  3.5/3.1 onError 第三参传值正确：触发 onError 后，第三参 === store 本体
 *        （改名最容易出的错是传了旧闭包变量 / undefined；签名对 ≠ 传值对）
 *
 * 运行：node test/host-adapter-selfcheck.mjs
 */

import Vue from 'vue'
import { definePageStore, registerPlugin } from 'vue-page-store'
import taskPlugin from '../src/index.js'

Vue.config.productionTip = false
Vue.config.devtools = false

const onErrorLog = []
registerPlugin(
  taskPlugin.create({
    onError: function (err, key, host) {
      onErrorLog.push({ err: err, key: key, host: host })
    }
  })
)

let _uid = 0
function makeStore (options) {
  const id = 'vpr-selfcheck-' + ++_uid + '-' + Math.random().toString(36).slice(2)
  const useStore = definePageStore(id, options)
  const vm = new Vue({})
  const store = useStore(vm)
  return { id: id, vm: vm, store: store }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
async function flush () { await tick(); await tick() }

let pass = 0
let fail = 0
const failures = []

function check (label, cond, detail) {
  if (cond) {
    pass++
    console.log('    ✓ ' + label)
  } else {
    fail++
    failures.push({ label: label, detail: detail })
    console.log('    ✗ ' + label + (detail ? '  → ' + detail : ''))
  }
}

// ============================================================================
// SC1 — 3.4：task 与 action 同名 → dev warn 触发一次
// ============================================================================
console.log('\nSC1 — 同名冲突检测被激活 (3.4)')
{
  const warnings = []
  const origWarn = console.warn
  console.warn = function () {
    warnings.push(Array.prototype.join.call(arguments, ' '))
    // 不转发到原 warn，保持输出干净；如需调试可改回 origWarn.apply
  }

  let actionRan = false
  let taskRan = false
  try {
    makeStore({
      state: () => ({}),
      actions: {
        // 与下面的 task 同名
        search () { actionRan = true }
      },
      tasks: {
        search: { trigger: 'manual', async run () { taskRan = true } }
      }
    })
  } finally {
    console.warn = origWarn
  }

  const conflictWarns = warnings.filter(function (w) {
    return w.indexOf('[vue-page-runtime]') > -1 &&
      w.indexOf('same name') > -1 &&
      w.indexOf('search') > -1
  })

  check('install 期间触发同名冲突 warn 恰好一次', conflictWarns.length === 1,
    'count=' + conflictWarns.length + ' all=' + JSON.stringify(warnings))
  check('warn 文案指向 host 上的同名函数字段', conflictWarns.length === 1 &&
    conflictWarns[0].indexOf('function field on host') > -1, conflictWarns[0])
  // 旁证：未触发执行（仅 install 期检测，不跑 task/action）
  check('仅检测，未误触发 task.run / action', taskRan === false && actionRan === false)
}

// ============================================================================
// SC2 — 3.5/3.1：onError 第三参 === store 本体引用相等
// ============================================================================
console.log('\nSC2 — onError 第三参传值相等 (3.5/3.1)')
{
  onErrorLog.length = 0
  const { store } = makeStore({
    state: () => ({}),
    tasks: {
      boom: {
        trigger: 'manual',
        async run () { throw new Error('selfcheck-boom') }
      }
    }
  })

  await store.$task.run('boom')
  await flush()

  const rec = onErrorLog.filter(function (e) { return e.key === 'boom' })
  check('onError 被调用一次', rec.length === 1, 'count=' + rec.length)
  check('第三参 === store 本体（引用相等，非 undefined / 旧闭包变量）',
    rec.length === 1 && rec[0].host === store,
    'host===store ? ' + (rec.length === 1 ? (rec[0].host === store) : 'n/a') +
    ' host=' + (rec.length === 1 ? (rec[0].host && rec[0].host.$id) : 'n/a'))
  check('第三参带正确的 $task API（确为 host 本体）',
    rec.length === 1 && rec[0].host && typeof rec[0].host.$task.run === 'function')
}

// ============================================================================
console.log('\n' + '='.repeat(60))
console.log('SELF-CHECK: ' + pass + ' passed, ' + fail + ' failed')
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach(function (f) {
    console.log('  ' + f.label + (f.detail ? '\n      ' + f.detail : ''))
  })
}
console.log('='.repeat(60))
process.exit(fail === 0 ? 0 : 1)
