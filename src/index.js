/**
 * vue-page-runtime 0.2.0-alpha.0
 *
 * vue-page-store 的任务编排插件。
 *
 * 0.2 主线：
 *   把页面数据流里的"节点语义"显性化。
 *
 *   读 tasks 配置 = 知道页面怎么跑。
 *
 * 核心：
 *   trigger  —— 谁叫醒这个 task
 *   canRun   —— 唤起后能不能执行           (0.2 新增)
 *   reset    —— 被 skip 时怎么清理自己      (0.2 新增)
 *   loading / abort —— 执行状态与并发取消
 *
 * 高级：
 *   deps     —— 极少数"本次执行前必须先 await 前置动作"的场景
 *
 * 0.2 完全向后兼容 0.1：
 *   不写 canRun / reset 等同于 0.1 行为。
 *
 * 不做：缓存 / stale / retry / debounce / queryKey /
 *      返回值存储 / 自动监听 canRun 依赖字段
 */

// ---- 内部 skip 标记 ----
//
// 内部语义，不暴露公开 API。
// 外部 $task.run() resolve 时会被剥成 undefined。

var SKIPPED = { __vpr_skipped__: true }

function isSkipped (result) {
  return result != null && result.__vpr_skipped__ === true
}

// ---- dev 检查 ----

function isDev () {
  return typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV !== 'production'
}

/**
 * 创建插件实例。
 *
 *   registerPlugin(taskPlugin)
 *   registerPlugin(taskPlugin.create({ onError }))
 *
 * @param {Object} [config]
 * @param {Function} [config.onError] - (error, key, store) => void
 */
function createPlugin (config) {
  var onError = (config && config.onError) || null

  return {
    name: 'tasks',

    install: function (store, taskDefs, ctx) {
      var Vue = ctx.Vue
      var keys = Object.keys(taskDefs || {})

      if (keys.length === 0) return

      // ---- 配置校验 ----
      //
      // run: 必填且必须是函数 → throw
      // deps: 可选；声明了就必须是数组、且 key 必须存在 → throw
      // canRun / reset: 可选；声明了就必须是函数 → dev warn

      keys.forEach(function (key) {
        var def = taskDefs[key]

        if (typeof def.run !== 'function') {
          throw new Error(
            '[vue-page-runtime] 任务 "' + key + '" 缺少 run 函数'
          )
        }

        if (def.deps !== undefined) {
          if (!Array.isArray(def.deps)) {
            throw new Error(
              '[vue-page-runtime] 任务 "' + key + '" 的 deps 必须是数组'
            )
          }
          def.deps.forEach(function (dep) {
            if (!taskDefs[dep]) {
              throw new Error(
                '[vue-page-runtime] 任务 "' + key + '" 的 deps 中包含不存在的 task "' + dep + '"'
              )
            }
          })
        }

        if (isDev()) {
          if (def.canRun !== undefined && typeof def.canRun !== 'function') {
            console.warn(
              '[vue-page-runtime] task "' + key + '" 的 canRun 必须是函数'
            )
          }
          if (def.reset !== undefined && typeof def.reset !== 'function') {
            console.warn(
              '[vue-page-runtime] task "' + key + '" 的 reset 必须是函数'
            )
          }
        }
      })

      // ---- 命名冲突提示 ----

      if (isDev()) {
        var actions = store.$options && store.$options.actions
        keys.forEach(function (key) {
          if (actions && typeof actions[key] === 'function') {
            console.warn(
              '[vue-page-runtime] task "' + key + '" has the same name as an action.'
            )
          }
        })
      }

      // ---- 响应式 loading ----

      keys.forEach(function (key) {
        if (store.$loading[key] === undefined) {
          Vue.set(store.$loading, key, false)
        }
      })

      // ---- 任务内部状态 ----

      var taskStateMap = {}
      keys.forEach(function (key) {
        taskStateMap[key] = { controller: null }
      })

      // ---- 错误上抛 ----

      function handleError (err, key) {
        if (onError) {
          try { onError(err, key, store) }
          catch (e) { console.error(e) }
        } else {
          console.error('[vue-page-runtime] 任务 "' + key + '" 执行失败:', err)
        }
      }

      // ---- reset ----

      function callReset (def, key) {
        if (typeof def.reset !== 'function') return
        try {
          def.reset.call(store)
        } catch (err) {
          handleError(err, key)
        }
      }

      // ---- abort ----
      //
      // abort 只负责"取消正在跑的请求 + 关 loading"。
      // 不调 reset。reset 只在 skip 路径上触发。

      function abortTask (key) {
        if (!taskStateMap[key]) return
        var state = taskStateMap[key]
        if (state.controller) {
          state.controller.abort()
          state.controller = null
          store.$loading[key] = false
        }
      }

      function abortAll () {
        keys.forEach(function (key) { abortTask(key) })
      }

      // ---- 协议核心 ----
      //
      // runTaskInternal(key)
      //
      //   1. 存在性 / disposed 检查
      //   2. abort previous          ← 必须在 canRun 之前
      //   3. canRun
      //        false → reset + skip (Promise resolve SKIPPED，loading 不开)
      //        抛错  → onError + resolve undefined（不算 skip，不触发 reset）
      //   4. 创建 controller + loading = true
      //   5. 跑 deps
      //   6. 任一 dep skipped → reset + loading=false + skip
      //   7. run
      //   8. 完成: loading=false / 失败: onError

      function runTaskInternal (key) {
        if (!taskDefs[key]) {
          if (isDev()) {
            console.warn('[vue-page-runtime] 任务 "' + key + '" 不存在')
          }
          return Promise.resolve(undefined)
        }

        if (store.$disposed) return Promise.resolve(undefined)

        var def = taskDefs[key]
        var state = taskStateMap[key]

        // 2. abort previous —— 在 canRun 之前
        //    用户清空条件后重新触发：哪怕 canRun=false 不再发新请求，
        //    旧请求也必须立刻取消，避免旧响应回来污染状态。
        abortTask(key)

        // 3. canRun
        if (typeof def.canRun === 'function') {
          var canRunResult
          try {
            canRunResult = def.canRun.call(store)
          } catch (err) {
            handleError(err, key)
            return Promise.resolve(undefined)
          }

          if (!canRunResult) {
            callReset(def, key)
            return Promise.resolve(SKIPPED)
          }
        }

        // 4. controller + loading
        var controller = typeof AbortController !== 'undefined'
          ? new AbortController()
          : { signal: null, abort: function () {} }
        state.controller = controller
        store.$loading[key] = true

        // 5. deps
        var deps = def.deps || []
        var depPromise = deps.length > 0
          ? Promise.all(deps.map(function (dep) { return runTaskInternal(dep) }))
          : Promise.resolve([])

        return depPromise.then(function (depResults) {
          // 6. dep skipped 传播
          var hasSkippedDep = depResults.some(isSkipped)
          if (hasSkippedDep) {
            if (state.controller === controller) {
              store.$loading[key] = false
              state.controller = null
            }
            callReset(def, key)
            return SKIPPED
          }

          // 当前执行已被取代或 store 已销毁 → 静默
          if (state.controller !== controller || store.$disposed) {
            return SKIPPED
          }

          // 7. run
          return def.run.call(store, { signal: controller.signal })
        }).then(function (result) {
          // 8. 完成
          if (state.controller === controller) {
            store.$loading[key] = false
            state.controller = null
          }
          return result
        }).catch(function (err) {
          // 已被取代 → 静默
          if (state.controller !== controller) return SKIPPED

          // run 抛错 → onError，不 reset
          store.$loading[key] = false
          state.controller = null
          handleError(err, key)
          return undefined
        })
      }

      // ---- 外部入口 ----
      //
      // 把内部 SKIPPED 标记剥成 undefined，对外不暴露 skip 概念。

      function runTaskExternal (key) {
        return runTaskInternal(key).then(function (result) {
          return isSkipped(result) ? undefined : result
        })
      }

      // ---- 挂载 API ----

      store.$task = {
        run: runTaskExternal,
        abort: abortTask
      }

      // ---- 按 trigger 批量执行 ----

      var initDone = false

      function runByTrigger (trigger) {
        if (store.$disposed) return Promise.resolve()
        var toRun = keys.filter(function (k) {
          var t = taskDefs[k].trigger || 'enter'
          return t === trigger
        })
        if (toRun.length === 0) return Promise.resolve()
        return Promise.all(toRun.map(function (k) { return runTaskInternal(k) }))
      }

      // ---- 生命周期钩子 ----

      return {
        enter: function () {
          var p = Promise.resolve()
          if (!initDone) {
            initDone = true
            p = p.then(function () { return runByTrigger('init') })
          }
          return p.then(function () { return runByTrigger('enter') })
        },
        leave: function () {
          // leave 只 abort，不 reset
          abortAll()
        },
        destroy: function () {
          // destroy 只 abort，不 reset
          abortAll()
        }
      }
    }
  }
}

// ---- 默认导出 ----

var defaultPlugin = createPlugin()
defaultPlugin.create = createPlugin

export default defaultPlugin
