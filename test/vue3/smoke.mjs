/**
 * 阶段 5 — Vue3 最小 smoke (基于 vue-page-scope@0.1.1)
 *
 * 隔离环境：本文件从 test/vue3/node_modules 解析 vue@3 / vue-page-scope /
 * jsdom，主 node_modules 的 vue@2.7.16 不受影响。runtime 取 ../../src/index.js。
 *
 * 真实挂载（scope 的 useScope 必须在 setup 内、依赖 getCurrentInstance +
 * onMounted/onBeforeUnmount），用 jsdom 提供 DOM，createApp().mount() 驱动。
 *
 * 只证明 host 接通：ctx.framework==='vue3' 分支走通、reactive 下 $loading 响应、
 * this 指向 scope、新增 loading key 在 Vue3 走直接赋值。不测复杂 deps。
 *
 * 运行：node test/vue3/smoke.mjs
 */

// ---- jsdom DOM 环境：必须排在所有其它 import 之前（ESM 按文本顺序求值）----
import './setup-dom.mjs'

import { createApp, h, watch, nextTick } from 'vue'
import { definePageScope, registerPlugin } from 'vue-page-scope'
import taskPlugin from '../../src/index.js'

// ---- 断言收集 ----
let pass = 0
let fail = 0
const failures = []
function check (label, cond, detail) {
  if (cond) { pass++; console.log('    ✓ ' + label) }
  else { fail++; failures.push({ label, detail }); console.log('    ✗ ' + label + (detail ? '  → ' + detail : '')) }
}

// ---- onError dispatcher（按 scope.$id 归集）----
const onErrorLog = []
registerPlugin(
  taskPlugin.create({
    onError (err, key, host) { onErrorLog.push({ hostId: host && host.$id, key, host }) }
  })
)

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
async function flush () { await nextTick(); await tick(); await tick() }

// 挂载一个页面组件：setup 内调用 useScope，捕获 scope 引用
function mountScope (useScope) {
  let scope = null
  const Page = {
    setup () {
      scope = useScope()
      return () => h('div', 'page')
    }
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(Page)
  app.mount(host)
  return { app, getScope: () => scope }
}

// ============================================================================
// Smoke A — 基础链路
// ============================================================================
async function smokeA () {
  console.log('\nSmoke A — 基础链路 (trigger enter 自动执行)')

  let runThis = null
  const useDemoScope = definePageScope('vpr-smoke-A', {
    source: () => ({ list: [] }),
    state: () => ({ keyword: '' }),
    tasks: {
      search: {
        trigger: 'enter',
        async run ({ signal }) {
          runThis = this
          this.$source.list = [this.keyword]
        }
      }
    }
  })

  check('registerPlugin(taskPlugin) 可用（已全局注册，无异常）', true)

  const { app, getScope } = mountScope(useDemoScope)
  const scope = getScope()

  check('useScope 在 setup 内返回 scope', !!scope && typeof scope === 'object')
  check('install 已挂 $task.run / $task.abort',
    scope && typeof scope.$task.run === 'function' && typeof scope.$task.abort === 'function')

  // $loading.search 经 reactive watch 观察（flush:sync 抓全部跳变）
  const tr = []
  const stop = watch(() => scope.$loading.search, (v) => tr.push(v), { flush: 'sync' })

  await flush() // 让 mounted→enter→run 的异步链路跑完

  check('mounted 触发 enter：search 自动执行（this.$source.list 被写）',
    Array.isArray(scope.$source.list) && scope.$source.list.length === 1 && scope.$source.list[0] === '',
    JSON.stringify(scope.$source.list))
  check('run 内 this 指向 scope 本体', runThis === scope)
  check('$source 可写（list 从空数组变为含空串单元素）', JSON.stringify(scope.$source.list) === '[""]')
  check('$loading.search 跳变 false→true→false（reactive 下响应，新 key 直接赋值即响应）',
    JSON.stringify(tr) === '[true,false]', JSON.stringify(tr))
  check('最终 $loading.search === false', scope.$loading.search === false)

  // $task.run 手动再触发
  scope.keyword = 'hello'
  const r = await scope.$task.run('search')
  await flush()
  check('$task.run 手动触发，list 更新为 ["hello"]', JSON.stringify(scope.$source.list) === '["hello"]', JSON.stringify(scope.$source.list))
  check('$task.run resolve（基础链路无 skip，resolve undefined）', r === undefined, 'r=' + r)

  // $task.abort 可用（运行中无请求时调用应安全 no-op）
  let abortThrew = false
  try { scope.$task.abort('search') } catch (e) { abortThrew = true }
  check('$task.abort 可调用且不抛错', abortThrew === false)

  stop()

  // $destroy 后再 run 不执行
  app.unmount() // onBeforeUnmount → runLeave + scope.$destroy
  await flush()
  check('unmount 后 scope.$disposed === true', scope.$disposed === true)

  const listBefore = JSON.stringify(scope.$source.list)
  let runAfterDestroy = false
  const useDestroyProbe = scope // same scope
  // 复用同一 task：dispose 后 runTaskInternal 应直接 resolve undefined，不执行 run
  const r2 = await useDestroyProbe.$task.run('search')
  await flush()
  check('$destroy 后再 $task.run 不执行 run（list 不变）', JSON.stringify(scope.$source.list) === listBefore, JSON.stringify(scope.$source.list))
  check('$destroy 后 $task.run resolve undefined', r2 === undefined, 'r2=' + r2)
}

// ============================================================================
// Smoke B — canRun / reset
// ============================================================================
async function smokeB () {
  console.log('\nSmoke B — canRun / reset')

  let resetCount = 0
  let runCount = 0
  const useVerScope = definePageScope('vpr-smoke-B', {
    source: () => ({ versionOptions: ['stale'] }),
    state: () => ({ productId: '' }),
    tasks: {
      loadVersionOptions: {
        trigger: 'manual',
        canRun () { return Boolean(this.productId) },
        reset () { resetCount++; this.$source.versionOptions = [] },
        async run () { runCount++; this.$source.versionOptions = ['v1'] }
      }
    }
  })

  const { app, getScope } = mountScope(useVerScope)
  const scope = getScope()
  await flush()

  check('manual：mounted 不自动执行', runCount === 0 && resetCount === 0, 'run=' + runCount + ' reset=' + resetCount)

  // productId 空 → skip + reset + versionOptions 清空
  const r1 = await scope.$task.run('loadVersionOptions')
  await flush()
  check('productId 空 → run 不执行', runCount === 0, 'run=' + runCount)
  check('productId 空 → reset 执行一次', resetCount === 1, 'reset=' + resetCount)
  check('productId 空 → versionOptions 被 reset 清空 []', JSON.stringify(scope.$source.versionOptions) === '[]', JSON.stringify(scope.$source.versionOptions))
  check('productId 空 → $task.run resolve undefined（skip 剥成 undefined）', r1 === undefined, 'r1=' + r1)
  check('productId 空 → 不触发 onError', onErrorLog.filter((e) => e.hostId === scope.$id).length === 0)

  // productId 有值 → run 正常
  scope.productId = 'p-100'
  const r2 = await scope.$task.run('loadVersionOptions')
  await flush()
  check('productId 有值 → run 正常执行', runCount === 1, 'run=' + runCount)
  check('productId 有值 → versionOptions = ["v1"]', JSON.stringify(scope.$source.versionOptions) === '["v1"]', JSON.stringify(scope.$source.versionOptions))
  check('productId 有值 → $loading.loadVersionOptions 最终 false', scope.$loading.loadVersionOptions === false)

  app.unmount()
}

// ============================================================================
await smokeA()
await smokeB()

console.log('\n' + '='.repeat(60))
console.log('VUE3 SMOKE: ' + pass + ' passed, ' + fail + ' failed')
console.log('host: vue-page-scope@0.1.1  |  vue@' + (await import('vue/package.json', { with: { type: 'json' } })).default.version)
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f.label + (f.detail ? '\n      ' + f.detail : '')))
}
console.log('='.repeat(60))
process.exit(fail === 0 ? 0 : 1)
