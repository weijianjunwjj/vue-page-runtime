/**
 * Headless 取证驱动 —— 用真实 Vue2 组件 + jsdom 真实挂载，消费与 SFC 页面
 * 完全相同的 store 模块（src/stores/*.js），驱动 enter/leave/keep-alive/慢请求
 * 等场景，从真实 DOM 观察 $loading 绑定与 abort 防污染。
 *
 * 这不是"再写脚本断言替代页面"：store 任务编排（被验证对象）与 npm run dev
 * 跑的页面是同一份 .js；这里只换了一个可在无头环境取证的视图层 + 生命周期驱动。
 * keep-alive 用 hook:activated/deactivated 驱动 —— 正是 keep-alive 真实派发的钩子。
 *
 * 时序说明：plugin enter 先 await 完所有 init 任务，再跑 enter 任务（init 阻塞 enter）。
 * 故首屏 fetchList 在 initOptions(700ms) 完成后才开始。断言用轮询而非定值 sleep。
 */

import './setup-dom.mjs'

import Vue from 'vue'
import { registerPlugin } from 'vue-page-store'
import taskPlugin from 'vue-page-runtime'
import { useCampaignListStore } from '../src/stores/campaignList.js'
import { useCampaignDetailStore } from '../src/stores/campaignDetail.js'
import * as api from '../src/mock/api.js'

Vue.config.productionTip = false
Vue.config.devtools = false
registerPlugin(taskPlugin)

let pass = 0
let fail = 0
const failures = []
const notes = []
function check (label, cond, detail) {
  if (cond) { pass++; console.log('    ✓ ' + label) }
  else { fail++; failures.push({ label, detail }); console.log('    ✗ ' + label + (detail ? '  → ' + detail : '')) }
}
function note (s) { notes.push(s) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitUntil (fn, timeout = 5000, step = 15) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(step) }
  return false
}

// ---- 真实 Vue2 组件（render 函数，把 $loading 绑到真实 DOM）----
const ListView = {
  name: 'CampaignListView',
  created () { this.ps = useCampaignListStore(this) },
  render (h) {
    const ps = this.ps
    return h('div', { attrs: { id: 'list-root' } }, [
      h('button', { attrs: { id: 'btn-fetch', disabled: ps.$loading.fetchList ? 'disabled' : null } }, 'fetch'),
      h('button', { attrs: { id: 'btn-update', disabled: ps.$loading.updateItem ? 'disabled' : null } }, 'update'),
      h('button', { attrs: { id: 'btn-summary', disabled: ps.$loading.loadSummary ? 'disabled' : null } }, 'summary'),
      ps.$loading.fetchList
        ? h('div', { attrs: { id: 'list-state' } }, 'loading list...')
        : h('div', { attrs: { id: 'list-state' } }, 'rows:' + ps.$source.rows.length),
      h('div', { attrs: { id: 'summary' } }, ps.$source.summary ? ('total:' + ps.$source.summary.total) : 'no-summary')
    ])
  }
}

const DetailView = {
  name: 'CampaignDetailView',
  props: ['id'],
  created () { this.ds = useCampaignDetailStore(this); this.ds.currentId = this.id },
  render (h) {
    const ds = this.ds
    return h('div', { attrs: { id: 'detail-root' } }, [
      h('div', { attrs: { id: 'detail-state' } }, ds.$loading.loadDetail ? 'loading detail...' : (ds.$source.detail ? ('detail:' + ds.$source.detail.id) : 'no-detail'))
    ])
  }
}

function mountInto (Component, propsData) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const vm = new Vue(Object.assign({}, Component, { propsData: propsData || {} }))
  vm.$mount(el)
  return vm
}

// DOM 读取必须 scope 到当前 vm.$el —— 多个场景的已销毁组件 DOM 仍留在 body 里，
// 用 document.getElementById 会读到更早场景的 stale 节点。
const q = (vm, id) => (vm.$el && vm.$el.querySelector ? vm.$el.querySelector('#' + id) : null)
const txt = (vm, id) => { const n = q(vm, id); return n ? n.textContent : null }
const disabled = (vm, id) => { const n = q(vm, id); return !!(n && n.hasAttribute('disabled')) }

// ============================================================================
async function scenario1_enterDepsLoading () {
  console.log('\n[S1] enter + init→enter 顺序 + $loading 真实 re-render(DOM)')
  api.resetCalls()
  const vm = mountInto(ListView)
  const ps = vm.ps

  // 等到 enter 阶段的 fetchList 真正进入 loading
  const gotLoading = await waitUntil(() => ps.$loading.fetchList === true)
  check('S1 进页面自动 enter→fetchList 进入 loading', gotLoading)
  check('S1 loading 真实映射 DOM：btn-fetch disabled + "loading list..."',
    disabled(vm, 'btn-fetch') && txt(vm, 'list-state') === 'loading list...',
    'disabled=' + disabled(vm, 'btn-fetch') + ' state=' + txt(vm, 'list-state'))
  check('S1 init 先于 enter 完成：fetchList loading 时 options 已就绪', ps.$source.options.status.length > 0,
    'opts=' + ps.$source.options.status.length)

  // 等 fetchList 完成
  const done = await waitUntil(() => ps.$loading.fetchList === false && ps.$source.rows.length > 0)
  check('S1 fetchList 完成，rows 写入', done && ps.$source.rows.length > 0, 'rows=' + ps.$source.rows.length)
  check('S1 完成后 $loading 恢复，DOM 重渲染 rows:N + button 可用',
    !disabled(vm, 'btn-fetch') && /^rows:\d+/.test(txt(vm, 'list-state')), 'state=' + txt(vm, 'list-state'))
  check('S1 initOptions(init) 仅 1 次（未被 deps 误重拉）', api.calls.fetchOptions === 1, 'fetchOptions=' + api.calls.fetchOptions)
  check('S1 fetchList 1 次', api.calls.fetchList === 1, 'fetchList=' + api.calls.fetchList)
  note('S1 $loading 在真实模板 re-render 下可靠：false→true→false 三态都驱动了 jsdom DOM 变化（button disabled 切换、"loading list..." ↔ "rows:N"）——这是之前 smoke 用 watch、未经真实 re-render 验证的盲区。')
  return vm
}

// ============================================================================
async function scenario2_keepAliveInitOnce (vm) {
  console.log('\n[S2] keep-alive：deactivate→activate，init 不重复、enter 重跑')
  const ps = vm.ps
  const optsBefore = api.calls.fetchOptions   // 1
  const listBefore = api.calls.fetchList       // 1

  vm.$emit('hook:deactivated')
  await sleep(30)
  check('S2 deactivate(leave) 后 loading 全 false（只 abort 不 reset）', ps.$loading.fetchList === false)

  vm.$emit('hook:activated')
  const reran = await waitUntil(() => api.calls.fetchList === listBefore + 1)
  check('S2 activate：enter 任务(fetchList)重跑', reran, 'fetchList=' + api.calls.fetchList)
  check('S2 activate：init 任务不重复（fetchOptions 计数不变=1）', api.calls.fetchOptions === optsBefore,
    'before=' + optsBefore + ' after=' + api.calls.fetchOptions)
  await waitUntil(() => ps.$loading.fetchList === false)
  note('S2 keep-alive 语义正确：activated 重跑 enter、init 一次性不重复；移除 fetchList 的 deps:[initOptions] 后 options 不再被重复拉取。')
}

// ============================================================================
async function scenario3_canRunResetSkip () {
  console.log('\n[S3] canRun 跳过 + reset 清理 + dep skip 传播')
  api.resetCalls()
  const vm = mountInto(ListView)
  const ps = vm.ps
  await waitUntil(() => ps.$source.rows.length > 0) // enter 完成

  // owner 空：ownerStats canRun=false → skip+reset；statusBreakdown 依赖它 → skip+reset
  ps.$source.ownerStats = { owner: 'stale', count: 999 }
  ps.$source.statusBreakdown = { stale: 1 }
  const before = api.calls.fetchList
  await ps.$task.run('ownerStats')
  await ps.$task.run('statusBreakdown')
  check('S3 owner 空 → ownerStats run 不执行（无新请求）', api.calls.fetchList === before, 'd=' + (api.calls.fetchList - before))
  check('S3 owner 空 → ownerStats.reset 清空为 null', ps.$source.ownerStats === null)
  check('S3 owner 空 → statusBreakdown 因 dep skip 传播 → skip + reset 清空', ps.$source.statusBreakdown === null)

  // owner 有值：整链正常
  ps.owner = 'u1'
  await ps.$task.run('ownerStats')
  await ps.$task.run('statusBreakdown')
  check('S3 owner 有值 → ownerStats 产出', ps.$source.ownerStats && ps.$source.ownerStats.owner === 'u1', JSON.stringify(ps.$source.ownerStats))
  check('S3 owner 有值 → statusBreakdown 产出（依赖 ownerStats 的本次结果）', !!ps.$source.statusBreakdown, JSON.stringify(ps.$source.statusBreakdown))
  note('S3 canRun/reset/skip 在页面里自然：一处声明 canRun，下游 deps 自动 skip + 各自 reset，无需手写级联清空。这是 deps 的【正确】用法（statusBreakdown 需要 ownerStats 的本次新结果）。')

  vm.$destroy()
  await sleep(20)
}

// ============================================================================
async function scenario4_multiLoadingIndependent () {
  console.log('\n[S4] 多任务独立 loading 不互相污染')
  api.resetCalls()
  const vm = mountInto(ListView)
  const ps = vm.ps
  await waitUntil(() => ps.$source.rows.length > 0) // enter 完成，loading 归零

  ps.$task.run('fetchList')   // ~800ms
  ps.$task.run('loadSummary') // ~1500ms
  await waitUntil(() => ps.$loading.fetchList === true && ps.$loading.loadSummary === true)
  check('S4 并发：fetchList / loadSummary loading 各自 true', ps.$loading.fetchList && ps.$loading.loadSummary)
  check('S4 DOM 同时反映两个独立 loading（两 button 各自 disabled）', disabled(vm, 'btn-fetch') && disabled(vm, 'btn-summary'))

  // 等 fetchList 完成而 loadSummary 仍在跑
  const independent = await waitUntil(() => ps.$loading.fetchList === false && ps.$loading.loadSummary === true)
  check('S4 fetchList 先完成→其 loading 归 false，loadSummary 不受影响仍 true（无串扰）', independent,
    'fetch=' + ps.$loading.fetchList + ' summary=' + ps.$loading.loadSummary)
  check('S4 DOM：btn-fetch 恢复可用、btn-summary 仍 disabled', !disabled(vm, 'btn-fetch') && disabled(vm, 'btn-summary'))

  await waitUntil(() => ps.$loading.loadSummary === false)
  check('S4 loadSummary 完成→loading 归 false，summary 写入 DOM', /^total:/.test(txt(vm, 'summary')), 'summary=' + txt(vm, 'summary'))
  note('S4 多任务 loading 互不污染：每个 task 独立 key，fetchList 先归零、loadSummary 独立持续，最终各自正确恢复，DOM 一一对应。')

  vm.$destroy()
  await sleep(20)
}

// ============================================================================
async function scenario5_leaveAbortNoPollution () {
  console.log('\n[S5] 离开列表页时未完成的 1500ms 慢请求返回不污染（leave→abort）')
  api.resetCalls()
  const vm = mountInto(ListView)
  const ps = vm.ps
  await waitUntil(() => ps.$source.rows.length > 0) // enter 完成，rows 已就绪
  const rowsLen = ps.$source.rows.length

  ps.$task.run('loadSummary')
  await waitUntil(() => ps.$loading.loadSummary === true && api.calls.fetchSummary === 1)
  check('S5 慢请求进行中：loadSummary loading=true、请求已发出', ps.$loading.loadSummary === true && api.calls.fetchSummary === 1)

  vm.$emit('hook:deactivated') // 离开（keep-alive leave → abortAll）
  await sleep(40)
  check('S5 leave 后 loadSummary loading 立即 false（abort，不残留）', ps.$loading.loadSummary === false)

  await sleep(1700) // 等慢请求本应返回之后
  check('S5 慢响应回来后 summary 仍为 null（已离开页面状态未被污染）', ps.$source.summary === null, 'summary=' + JSON.stringify(ps.$source.summary))
  check('S5 leave 只 abort：已加载的 rows 未被误清', ps.$source.rows.length === rowsLen, 'rows=' + ps.$source.rows.length)
  note('S5 leave→abort 真实生效：1500ms 慢响应回来时 controller 已被取代，runtime 静默丢弃，$source 未被旧响应覆盖。前提是 run 把 signal 透传给可中断 API（Lab mock 已 honor signal）。')

  vm.$destroy()
  await sleep(20)
}

// ============================================================================
async function scenario6_routeDetailSlowBackAbort () {
  console.log('\n[S6] 列表→详情(1500ms)→未加载完即返回：destroy→abort 不污染')
  api.resetCalls()
  const vm = mountInto(DetailView, { id: 'c5' })
  const ds = vm.ds
  await waitUntil(() => ds.$loading.loadDetail === true && api.calls.fetchDetail === 1)
  check('S6 进入详情自动 enter loadDetail（canRun(currentId)=true）loading=true', ds.$loading.loadDetail === true)

  vm.$destroy() // 返回列表 → beforeDestroy(runLeave) + $destroy
  await sleep(1700)
  check('S6 返回后慢请求被 abort，detail 未写入（disposed 不污染）', ds.$source.detail === null && ds.$disposed === true,
    'detail=' + JSON.stringify(ds.$source.detail) + ' disposed=' + ds.$disposed)
  note('S6 第二个路由页：切走时未完成的详情慢请求经 destroy→abort 丢弃，不污染。')
}

// ============================================================================
async function main () {
  const vm1 = await scenario1_enterDepsLoading()
  await scenario2_keepAliveInitOnce(vm1)
  vm1.$destroy()
  await sleep(20)

  await scenario3_canRunResetSkip()
  await scenario4_multiLoadingIndependent()
  await scenario5_leaveAbortNoPollution()
  await scenario6_routeDetailSlowBackAbort()

  console.log('\n' + '='.repeat(64))
  console.log('LAB HEADLESS: ' + pass + ' passed, ' + fail + ' failed')
  console.log('env: vue@' + Vue.version + '  vue-page-store@0.5.3  vue-page-runtime@0.2.0-alpha.1 (file: tarball)')
  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  ' + f.label + (f.detail ? '\n      ' + f.detail : '')))
  }
  console.log('\nOBSERVATIONS (for LAB_REPORT):')
  notes.forEach((n) => console.log('  • ' + n))
  console.log('='.repeat(64))
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
