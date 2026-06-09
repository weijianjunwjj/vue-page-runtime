/**
 * Mock async API — 全虚拟数据，不接任何真实接口 / 业务字段。
 *
 * 通用领域：活动(campaign) / 列表项(item)。完全自编。
 *
 * 关键设计：
 *  - 分档延迟：常规 ~800ms；慢接口 ~1500ms（用于 route leave / keep-alive 离开时
 *    "慢请求返回不能污染已离开页面" 的验证）。
 *  - honor AbortSignal：所有请求接收 { signal }，signal abort 时立即 reject(AbortError)。
 *    这是 runtime leave→abort 能真正防污染的前提——run 体必须把 signal 透传给可中断的 API。
 */

function delay (ms, signal) {
  return new Promise(function (resolve, reject) {
    if (signal && signal.aborted) {
      return reject(makeAbortError())
    }
    var t = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener('abort', function () {
        clearTimeout(t)
        reject(makeAbortError())
      }, { once: true })
    }
  })
}

function makeAbortError () {
  var e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

// ---- 虚拟数据源 ----

var STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'closed', label: '已结束' }
]

var TYPE_OPTIONS = [
  { value: 'promo', label: '促销' },
  { value: 'survey', label: '问卷' },
  { value: 'lottery', label: '抽奖' }
]

var OWNER_OPTIONS = [
  { value: 'u1', label: 'Alice' },
  { value: 'u2', label: 'Bob' },
  { value: 'u3', label: 'Carol' }
]

function makeRow (i) {
  var st = STATUS_OPTIONS[i % STATUS_OPTIONS.length]
  var tp = TYPE_OPTIONS[i % TYPE_OPTIONS.length]
  var ow = OWNER_OPTIONS[i % OWNER_OPTIONS.length]
  return {
    id: 'c' + i,
    name: 'Campaign #' + i,
    status: st.value,
    type: tp.value,
    owner: ow.value,
    joined: (i * 37) % 500
  }
}

var ALL_ROWS = []
for (var i = 1; i <= 53; i++) ALL_ROWS.push(makeRow(i))

// ---- 调用计数（仅 Lab 验证用，不影响运行时行为）----
export var calls = {
  fetchOptions: 0, fetchList: 0, fetchDetail: 0, fetchSummary: 0,
  updateStatus: 0, submitItem: 0
}
export function resetCalls () {
  Object.keys(calls).forEach(function (k) { calls[k] = 0 })
}

// ---- API ----

export function fetchOptions (opts) {
  opts = opts || {}
  calls.fetchOptions++
  return delay(700, opts.signal).then(function () {
    return {
      status: STATUS_OPTIONS.slice(),
      type: TYPE_OPTIONS.slice(),
      owner: OWNER_OPTIONS.slice()
    }
  })
}

export function fetchList (params, opts) {
  params = params || {}
  opts = opts || {}
  calls.fetchList++
  return delay(800, opts.signal).then(function () {
    var rows = ALL_ROWS.slice()
    if (params.keyword) {
      var kw = String(params.keyword).toLowerCase()
      rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(kw) > -1 })
    }
    if (params.status) rows = rows.filter(function (r) { return r.status === params.status })
    if (params.owner) rows = rows.filter(function (r) { return r.owner === params.owner })
    var page = params.page || 1
    var size = params.size || 10
    var start = (page - 1) * size
    return {
      total: rows.length,
      page: page,
      size: size,
      rows: rows.slice(start, start + size)
    }
  })
}

// 慢接口：1500ms，用于 leave / keep-alive 离开时的慢请求验证
export function fetchDetail (id, opts) {
  opts = opts || {}
  calls.fetchDetail++
  return delay(1500, opts.signal).then(function () {
    var row = ALL_ROWS.filter(function (r) { return r.id === id })[0]
    if (!row) throw new Error('not found: ' + id)
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      type: row.type,
      owner: row.owner,
      joined: row.joined,
      description: 'Auto-generated description for ' + row.name,
      fetchedAt: Date.now()
    }
  })
}

// 慢接口：1500ms，列表页专用 —— 验证"离开列表页时未完成的慢请求返回不能污染状态"
export function fetchSummary (params, opts) {
  params = params || {}
  opts = opts || {}
  calls.fetchSummary++
  return delay(1500, opts.signal).then(function () {
    return {
      total: ALL_ROWS.length,
      active: ALL_ROWS.filter(function (r) { return r.status === 'active' }).length,
      builtAt: Date.now()
    }
  })
}

export function updateStatus (id, status, opts) {
  opts = opts || {}
  calls.updateStatus++
  return delay(600, opts.signal).then(function () {
    var row = ALL_ROWS.filter(function (r) { return r.id === id })[0]
    if (row) row.status = status
    return { id: id, status: status, ok: true }
  })
}

export function submitItem (payload, opts) {
  opts = opts || {}
  calls.submitItem++
  return delay(900, opts.signal).then(function () {
    var i = ALL_ROWS.length + 1
    var row = makeRow(i)
    if (payload && payload.name) row.name = payload.name
    ALL_ROWS.push(row)
    return { id: row.id, ok: true }
  })
}
