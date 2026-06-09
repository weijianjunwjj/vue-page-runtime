/**
 * vue-page-runtime 0.2.0-alpha — 任务语义验证 (阶段 1)
 *
 * 方法学：真实 host (vue-page-store) + 无头 Vue 实例 + 手动 emit 生命周期钩子
 *         + deferred-promise 叶子 stub。不引 runner，纯 Node ESM。
 *
 *   - host：真实 definePageStore / useStore / bindTo（不手搓 stub）
 *   - 驱动：new Vue({}) → useStore(vm) → vm.$emit('hook:mounted' 等)
 *   - loading 断言：通过 store._vm.$watch 观察真实响应式链路（不是裸对象读）
 *   - 叶子异步：run 内 await deferred.promise，由测试按命令 resolve/reject
 *
 * 运行：node test/runtime-alpha0.spec.mjs
 */

import Vue from 'vue'
import { definePageStore, registerPlugin } from 'vue-page-store'
import taskPlugin from '../src/index.js'

Vue.config.productionTip = false
Vue.config.devtools = false

// ----------------------------------------------------------------------------
// 全局：只注册一个 tasks plugin（registerPlugin 按 name 去重）。
// onError 是共享 dispatcher，按 host.$id 归集，测试各自过滤。
// ----------------------------------------------------------------------------

const onErrorLog = [] // { hostId, key, message, host }
registerPlugin(
  taskPlugin.create({
    onError: function (err, key, host) {
      onErrorLog.push({
        hostId: host && host.$id,
        key: key,
        message: (err && err.message) || String(err),
        host: host
      })
    }
  })
)

// ----------------------------------------------------------------------------
// 工具
// ----------------------------------------------------------------------------

function deferred () {
  let resolve, reject
  const promise = new Promise(function (res, rej) {
    resolve = res
    reject = rej
  })
  return { promise: promise, resolve: resolve, reject: reject }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
// 两个宏任务回合，足以排干运行时多层 .then 链（含嵌套 deps）
async function flush () {
  await tick()
  await tick()
}

let _uid = 0
function makeStore (options) {
  const id = 'vpr-test-' + ++_uid + '-' + Math.random().toString(36).slice(2)
  const useStore = definePageStore(id, options)
  const vm = new Vue({})
  const store = useStore(vm) // bindTo + init
  return { id: id, vm: vm, store: store }
}

// 通过真实响应式链路记录 $loading[key] 的跳变序列
function watchLoading (store, key) {
  const transitions = []
  store._vm.$watch(
    function () {
      return store.$loading[key]
    },
    function (v) {
      transitions.push(v)
    }
  )
  return transitions
}

function errorsFor (id) {
  return onErrorLog.filter(function (e) {
    return e.hostId === id
  })
}

// ----------------------------------------------------------------------------
// 断言收集
// ----------------------------------------------------------------------------

let pass = 0
let fail = 0
const failures = []
let _caseName = ''

function check (label, cond, detail) {
  if (cond) {
    pass++
    console.log('    ✓ ' + label)
  } else {
    fail++
    failures.push({ case: _caseName, label: label, detail: detail })
    console.log('    ✗ ' + label + (detail ? '  → ' + detail : ''))
  }
}

async function runCase (name, fn) {
  _caseName = name
  console.log('\n' + name)
  try {
    await fn()
  } catch (e) {
    fail++
    failures.push({ case: name, label: 'THREW', detail: e && e.stack })
    console.log('    ✗ THREW → ' + (e && e.message))
  }
}

// ============================================================================
// Case 1 — enter 默认触发
// search 执行一次；trigger 默认=enter；$loading.search false→true→false
// ============================================================================
await runCase('Case 1 — enter 默认触发', async function () {
  let runCount = 0
  const d = deferred()
  const { vm, store } = makeStore({
    state: () => ({}),
    tasks: {
      search: {
        // 无 trigger → 默认 enter
        async run () {
          runCount++
          await d.promise
        }
      }
    }
  })
  const tr = watchLoading(store, 'search')

  check('初始 $loading.search === false', store.$loading.search === false)

  vm.$emit('hook:mounted') // enter
  await flush()
  check('mounted(enter) 后 run 执行一次 (trigger 默认 enter)', runCount === 1, 'runCount=' + runCount)
  check('run 进行中 $loading.search === true', store.$loading.search === true)

  d.resolve()
  await flush()
  check('run 完成后 $loading.search === false', store.$loading.search === false)
  check('loading 跳变序列 = [true,false] (false→true→false)', JSON.stringify(tr) === '[true,false]', JSON.stringify(tr))
})

// ============================================================================
// Case 2 — init 只一次
// 第一次 enter 执行 init；keep-alive 再 enter 时 init 不重复，enter 任务重复
// ============================================================================
await runCase('Case 2 — init 只一次', async function () {
  let bootCount = 0
  let enterCount = 0
  const { vm } = makeStore({
    state: () => ({}),
    tasks: {
      boot: { trigger: 'init', async run () { bootCount++ } },
      ping: { trigger: 'enter', async run () { enterCount++ } }
    }
  })

  vm.$emit('hook:mounted') // enter #1 → init + enter
  await flush()
  check('mounted 后 init 任务执行一次', bootCount === 1, 'bootCount=' + bootCount)
  check('mounted 后 enter 任务执行一次', enterCount === 1, 'enterCount=' + enterCount)

  vm.$emit('hook:deactivated') // leave
  vm.$emit('hook:activated') // enter #2 (keep-alive)
  await flush()
  check('再次 enter：init 任务不重复 (仍为 1)', bootCount === 1, 'bootCount=' + bootCount)
  check('再次 enter：enter 任务重复 (=2)', enterCount === 2, 'enterCount=' + enterCount)
})

// ============================================================================
// Case 3 — manual 不自动
// enter 不执行；$task.run 才执行
// ============================================================================
await runCase('Case 3 — manual 不自动', async function () {
  let runCount = 0
  const { vm, store } = makeStore({
    state: () => ({}),
    tasks: {
      load: { trigger: 'manual', async run () { runCount++ } }
    }
  })

  vm.$emit('hook:mounted')
  await flush()
  check('enter 不触发 manual 任务', runCount === 0, 'runCount=' + runCount)

  await store.$task.run('load')
  await flush()
  check('$task.run 后 manual 任务执行', runCount === 1, 'runCount=' + runCount)
})

// ============================================================================
// Case 4 — canRun=false → skip + reset
// run 不执行；reset 执行一次；不开新 loading；$task.run resolve undefined；不触发 onError
// ============================================================================
await runCase('Case 4 — canRun=false skip + reset', async function () {
  let runCount = 0
  let resetCount = 0
  const { id, store } = makeStore({
    state: () => ({}),
    tasks: {
      search: {
        trigger: 'manual',
        canRun () { return false },
        reset () { resetCount++ },
        async run () { runCount++ }
      }
    }
  })
  const tr = watchLoading(store, 'search')

  const result = await store.$task.run('search')
  await flush()

  check('run 不执行', runCount === 0, 'runCount=' + runCount)
  check('reset 执行一次', resetCount === 1, 'resetCount=' + resetCount)
  check('不开新 loading（无跳变，且当前 false）', tr.length === 0 && store.$loading.search === false, JSON.stringify(tr))
  check('$task.run resolve undefined', result === undefined, 'result=' + result)
  check('不触发 onError', errorsFor(id).length === 0, 'errors=' + errorsFor(id).length)
})

// ============================================================================
// Case 5 — canRun=false 反复触发 → 每次都 reset
// (验证非 true→false 跳变语义)
// ============================================================================
await runCase('Case 5 — canRun=false 反复触发，每次都 reset', async function () {
  let resetCount = 0
  const { store } = makeStore({
    state: () => ({}),
    tasks: {
      search: {
        trigger: 'manual',
        canRun () { return false },
        reset () { resetCount++ },
        async run () {}
      }
    }
  })

  await store.$task.run('search')
  await store.$task.run('search')
  await store.$task.run('search')
  await flush()

  check('连续 3 次 canRun=false → reset 触发 3 次', resetCount === 3, 'resetCount=' + resetCount)
})

// ============================================================================
// Case 6 — canRun 抛错
// run 不执行；reset 不执行；onError 被调用；loading 不残留 true
// ============================================================================
await runCase('Case 6 — canRun 抛错', async function () {
  let runCount = 0
  let resetCount = 0
  const { id, store } = makeStore({
    state: () => ({}),
    tasks: {
      search: {
        trigger: 'manual',
        canRun () { throw new Error('canRun-boom') },
        reset () { resetCount++ },
        async run () { runCount++ }
      }
    }
  })

  const result = await store.$task.run('search')
  await flush()

  check('run 不执行', runCount === 0, 'runCount=' + runCount)
  check('reset 不执行', resetCount === 0, 'resetCount=' + resetCount)
  check('onError 被调用一次', errorsFor(id).length === 1, 'errors=' + errorsFor(id).length)
  check('loading 不残留 true', store.$loading.search === false)
  check('$task.run resolve undefined', result === undefined, 'result=' + result)
})

// ============================================================================
// Case 7 — deps 顺序 + deps 等待期间 loading 仍 true
// prepare 先、search 后；deps 等待期间 $loading.search===true；最终都回 false
// ============================================================================
await runCase('Case 7 — deps 顺序，等待期间 loading=true', async function () {
  const order = []
  const dPrepare = deferred()
  const dSearch = deferred()
  const { vm, store } = makeStore({
    state: () => ({}),
    tasks: {
      prepare: {
        trigger: 'manual',
        async run () { order.push('prepare'); await dPrepare.promise }
      },
      search: {
        trigger: 'enter',
        deps: ['prepare'],
        async run () { order.push('search'); await dSearch.promise }
      }
    }
  })

  vm.$emit('hook:mounted')
  await flush()

  check('prepare 已开始、search 尚未开始 (deps 等待中)', order.length === 1 && order[0] === 'prepare', JSON.stringify(order))
  check('deps 等待期间 $loading.search === true', store.$loading.search === true)
  check('deps 等待期间 $loading.prepare === true', store.$loading.prepare === true)

  dPrepare.resolve()
  await flush()
  check('prepare 完成后 $loading.prepare === false', store.$loading.prepare === false)
  check('prepare 完成后 search 才开始 (顺序 prepare→search)', JSON.stringify(order) === '["prepare","search"]', JSON.stringify(order))
  check('search 进行中 $loading.search 仍 === true', store.$loading.search === true)

  dSearch.resolve()
  await flush()
  check('全部完成后 $loading.search === false', store.$loading.search === false)
})

// ============================================================================
// Case 8 — dep skipped 传播
// prepare reset 执行；search reset 执行；search run 不执行；$task.run('search') resolve undefined
// ============================================================================
await runCase('Case 8 — dep skipped 传播', async function () {
  let prepareReset = 0
  let searchReset = 0
  let searchRun = 0
  const { store } = makeStore({
    state: () => ({}),
    tasks: {
      prepare: {
        trigger: 'manual',
        canRun () { return false },
        reset () { prepareReset++ },
        async run () {}
      },
      search: {
        trigger: 'manual',
        deps: ['prepare'],
        reset () { searchReset++ },
        async run () { searchRun++ }
      }
    }
  })
  const tr = watchLoading(store, 'search')

  const result = await store.$task.run('search')
  await flush()

  check('prepare reset 执行', prepareReset === 1, 'prepareReset=' + prepareReset)
  check('search reset 执行 (dep skip 传播)', searchReset === 1, 'searchReset=' + searchReset)
  check('search run 不执行', searchRun === 0, 'searchRun=' + searchRun)
  check('$task.run(search) resolve undefined', result === undefined, 'result=' + result)
  check('最终 $loading.search === false', store.$loading.search === false)
  check('loading 曾因 deps 置 true 又回落 [true,false]', JSON.stringify(tr) === '[true,false]', JSON.stringify(tr))
})

// ============================================================================
// Case 9 — run 抛错
// onError 被调用；loading=false；不 reset
// ============================================================================
await runCase('Case 9 — run 抛错', async function () {
  let resetCount = 0
  const { id, store } = makeStore({
    state: () => ({}),
    tasks: {
      search: {
        trigger: 'manual',
        reset () { resetCount++ },
        async run () { throw new Error('run-boom') }
      }
    }
  })

  await store.$task.run('search')
  await flush()

  check('onError 被调用一次', errorsFor(id).length === 1, 'errors=' + errorsFor(id).length)
  check('loading=false', store.$loading.search === false)
  check('run 抛错不触发 reset', resetCount === 0, 'resetCount=' + resetCount)
})

// ============================================================================
// Case 10 — abort / leave / destroy
// 重复 run abort 上次；leave/destroy abort 所有运行中；abort 后 loading false；abort 不触发 reset/onError
// ============================================================================
await runCase('Case 10 — abort / leave / destroy', async function () {
  // 10a：重复 run abort 上次
  {
    let resetCount = 0
    const signals = []
    const dNever = deferred()
    const { store } = makeStore({
      state: () => ({}),
      tasks: {
        search: {
          trigger: 'manual',
          reset () { resetCount++ },
          async run ({ signal }) { signals.push(signal); await dNever.promise }
        }
      }
    })
    store.$task.run('search')
    await flush()
    store.$task.run('search') // 应 abort 上一次
    await flush()
    check('10a 重复 run：上一次 signal 被 abort', signals.length === 2 && signals[0].aborted === true, 'aborted=' + (signals[0] && signals[0].aborted))
    check('10a 重复 run：当前仍在跑 loading=true', store.$loading.search === true)
    check('10a abort 不触发 reset', resetCount === 0, 'resetCount=' + resetCount)
  }

  // 10b：leave abort 所有运行中
  {
    let resetCount = 0
    const dNever = deferred()
    let sig
    const { id, vm, store } = makeStore({
      state: () => ({}),
      tasks: {
        search: {
          trigger: 'enter',
          reset () { resetCount++ },
          async run ({ signal }) { sig = signal; await dNever.promise }
        }
      }
    })
    vm.$emit('hook:mounted')
    await flush()
    check('10b enter 后 loading=true', store.$loading.search === true)
    vm.$emit('hook:deactivated') // leave → abortAll
    await flush()
    check('10b leave 后 signal 被 abort', sig && sig.aborted === true)
    check('10b leave 后 $loading.search === false', store.$loading.search === false)
    check('10b leave 不触发 reset', resetCount === 0, 'resetCount=' + resetCount)
    check('10b leave 不触发 onError', errorsFor(id).length === 0, 'errors=' + errorsFor(id).length)
  }

  // 10c：destroy abort 所有运行中
  {
    let resetCount = 0
    const dNever = deferred()
    let sig
    const { id, vm, store } = makeStore({
      state: () => ({}),
      tasks: {
        search: {
          trigger: 'enter',
          reset () { resetCount++ },
          async run ({ signal }) { sig = signal; await dNever.promise }
        }
      }
    })
    vm.$emit('hook:mounted')
    await flush()
    vm.$emit('hook:beforeDestroy') // runLeave + $destroy → abortAll
    await flush()
    check('10c destroy 后 signal 被 abort', sig && sig.aborted === true)
    check('10c destroy 后 $loading.search === false', store.$loading.search === false)
    check('10c destroy 不触发 reset', resetCount === 0, 'resetCount=' + resetCount)
    check('10c destroy 不触发 onError', errorsFor(id).length === 0, 'errors=' + errorsFor(id).length)
    check('10c destroy 后 $disposed=true，再 run 不执行', store.$disposed === true)
  }
})

// ============================================================================
// Case 11 — canRun 求值时序
// 在已有运行中的 task 上 run，且新 canRun=false：
// 旧请求被 abort(旧 loading 关) + 不开新 loading + reset
// ============================================================================
await runCase('Case 11 — canRun 求值时序（运行中再触发且 canRun=false）', async function () {
  let allowed = true
  let resetCount = 0
  let runCount = 0
  const signals = []
  const dNever = deferred()
  const { store } = makeStore({
    state: () => ({}),
    tasks: {
      search: {
        trigger: 'manual',
        canRun () { return allowed },
        reset () { resetCount++ },
        async run ({ signal }) { runCount++; signals.push(signal); await dNever.promise }
      }
    }
  })
  const tr = watchLoading(store, 'search')

  // 第一次：canRun=true → 开 loading + run（挂起）
  store.$task.run('search')
  await flush()
  check('11 首次 run：canRun=true 已开 loading', store.$loading.search === true)
  check('11 首次 run：run 已执行', runCount === 1, 'runCount=' + runCount)

  // 条件失效，运行中再触发
  allowed = false
  const result = await store.$task.run('search')
  await flush()

  check('11 旧请求 signal 被 abort（abort 在 canRun 之前）', signals[0].aborted === true, 'aborted=' + signals[0].aborted)
  check('11 不开新 loading 且旧 loading 已关 → $loading.search === false', store.$loading.search === false)
  check('11 canRun=false → reset 触发', resetCount === 1, 'resetCount=' + resetCount)
  check('11 不再次执行 run', runCount === 1, 'runCount=' + runCount)
  check('11 $task.run resolve undefined', result === undefined, 'result=' + result)
  check('11 loading 跳变序列 [true,false]', JSON.stringify(tr) === '[true,false]', JSON.stringify(tr))
})

// ============================================================================
// 汇总
// ============================================================================
console.log('\n' + '='.repeat(60))
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach(function (f) {
    console.log('  [' + f.case + '] ' + f.label + (f.detail ? '\n      ' + f.detail : ''))
  })
}
console.log('='.repeat(60))
process.exit(fail === 0 ? 0 : 1)
