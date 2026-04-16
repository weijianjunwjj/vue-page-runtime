/**
 * vue-page-runtime 0.1.0
 *
 * vue-page-store 的任务编排插件。
 *
 * 声明 tasks 字段 → 获得三件事：
 *   1. 按 trigger 自动运行
 *   2. 依赖顺序
 *   3. loading / abort
 *
 * 仅此而已。
 */

/**
 * 创建插件实例。
 *
 * 支持两种用法：
 *   registerPlugin(taskPlugin)
 *   registerPlugin(taskPlugin({ onError }))
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

      // ---- 校验 ----

      keys.forEach(function (key) {
        var def = taskDefs[key]
        if (typeof def.run !== 'function') {
          throw new Error(
            '[vue-page-runtime] 任务 "' + key + '" 缺少 run 函数'
          )
        }
      })

      // 命名冲突提示
      if (typeof process !== 'undefined' &&
          process.env &&
          process.env.NODE_ENV !== 'production') {
        var actions = store.$options && store.$options.actions
        // page-store 把 actions 方法直接挂在 store 上，这里通过名字检测冲突
        keys.forEach(function (key) {
          if (actions && typeof actions[key] === 'function') {
            console.warn(
              '[vue-page-runtime] task "' + key + '" has the same name as an action.'
            )
          }
        })
      }

      // ---- 响应式 loading ----
      // 直接写到 store.$loading（和 action 的 $loading 共享命名空间）

      keys.forEach(function (key) {
        if (store.$loading[key] === undefined) {
          Vue.set(store.$loading, key, false)
        }
      })

      // ---- 任务内部状态（非响应式，运行时追踪）----

      var taskStateMap = {}
      keys.forEach(function (key) {
        taskStateMap[key] = {
          controller: null
        }
      })

      // ---- abort ----

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

      // ---- run ----

      function runTask (key) {
        if (!taskDefs[key]) {
          if (typeof process !== 'undefined' &&
              process.env &&
              process.env.NODE_ENV !== 'production') {
            console.warn('[vue-page-runtime] 任务 "' + key + '" 不存在')
          }
          return Promise.resolve()
        }

        if (store.$disposed) return Promise.resolve()

        var def = taskDefs[key]
        var state = taskStateMap[key]

        // 1. abort 上一次
        abortTask(key)

        // 2. 新的 controller
        var controller = typeof AbortController !== 'undefined'
          ? new AbortController()
          : { signal: null, abort: function () {} }
        state.controller = controller
        store.$loading[key] = true

        // 3. 等依赖
        var deps = def.deps || []
        var depPromise = deps.length > 0
          ? Promise.all(deps.map(function (dep) { return runTask(dep) }))
          : Promise.resolve()

        return depPromise.then(function () {
          // 依赖跑完后检查：自己是否还是当前执行
          // （可能依赖跑的时候，外部又调了一次 $task.run(key)，abort 了我们）
          if (state.controller !== controller || store.$disposed) return

          return def.run.call(store, { signal: controller.signal })
        }).then(function (result) {
          if (state.controller === controller) {
            store.$loading[key] = false
            state.controller = null
          }
          return result
        }).catch(function (err) {
          // 如果这次执行已经被取代/取消了 → 静默
          if (state.controller !== controller) return

          // 还是当前执行 → 清理 + 抛给 onError
          store.$loading[key] = false
          state.controller = null

          if (onError) {
            try { onError(err, key, store) }
            catch (e) { console.error(e) }
          } else {
            console.error('[vue-page-runtime] 任务 "' + key + '" 执行失败:', err)
          }
        })
      }

      // ---- 挂载 API ----

      store.$task = {
        run: runTask,
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
        return Promise.all(toRun.map(function (k) { return runTask(k) }))
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
          abortAll()
        },
        destroy: function () {
          abortAll()
        }
      }
    }
  }
}

// ---- 默认导出：可直接用，也可带配置用 ----

var defaultPlugin = createPlugin()

// registerPlugin(taskPlugin) 直接用
defaultPlugin.create = createPlugin

// registerPlugin(taskPlugin({ onError })) 也能用
// 通过把函数本身变成"可调用对象" —— 但 JS 做不到。
// 换个思路：导出 plugin 对象，create 方法用于定制。
//
// 用户要带配置时：
//   import taskPlugin from 'vue-page-runtime'
//   registerPlugin(taskPlugin.create({ onError: ... }))

export default defaultPlugin
