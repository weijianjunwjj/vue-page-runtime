# vue-page-runtime

> vue-page-store 的任务编排插件 —— 在 `definePageStore` 中声明 `tasks`,把页面数据流搬到一处声明出来。

## 它为什么存在

`vue-page-store` 已经能管理页面状态,但复杂页面真正难读的,往往不是状态本身,而是状态背后的数据流:

- 哪些请求进入页面就跑
- 哪些请求只初始化一次
- 哪些条件不满足时不该跑
- 上游条件变化后,下游状态怎么清理
- 哪些逻辑散落在 `init / enter / watch / actions` 里

如果这些逻辑分散在各处,新人接手必须读完整个页面,才能在脑子里重建一张"页面怎么跑"的图。

`vue-page-runtime` 的目的,就是把这张图搬到一处声明出来。

读 `tasks` 配置,应该能够知道这个页面的数据流如何启动、如何判断、如何跳过、如何清理。不用跳文件,不用脑内推演,不用问人。

这是 `vue-page-runtime` 存在的唯一理由。所有 API 设计都服务于这一点:

- `trigger` —— 这个任务什么时候被唤起
- `canRun` —— 这个任务当前有没有资格执行
- `reset` —— 这个任务被 skip 时,如何清理自己的旧结果
- `deps` —— 少数高级场景下,这个任务执行前每次必须先执行谁

能让页面数据流在声明层更可读的,就做。

---

## 0.2 在 0.1 上加了什么

| 新增 | 作用 |
|---|---|
| `canRun` | 声明式资格判断,在 abort previous 之后、deps 之前评估 |
| `reset` | task 被 skip 时同步触发的清理钩子 |
| `deps` 校验 | `deps` 必须是数组,且 key 必须存在;0.1 静默,0.2 抛错 |

**完全向后兼容 0.1**:不写 `canRun` / `reset` 的 task,行为和 0.1 一致。从 0.1 升级到 0.2 不需要改业务代码。

---

## 安装

```bash
# 验证期(alpha tag)
npm install vue-page-runtime@alpha

# 验证通过后将发布为 latest
# npm install vue-page-runtime
```

发布产物:

- CommonJS:`dist/index.cjs.js`
- ESM:`dist/index.esm.js`
- UMD:`dist/index.umd.js`
- UMD min:`dist/index.umd.min.js`

同时保留 `dist/index.cjs` / `dist/index.mjs` 作为 package `exports` 入口,兼容旧版引用路径。

构建:

```bash
npm run build
```

Host(二选一,任选其一作为运行宿主):

- **Vue 2.6** —— `vue-page-store@^0.5.0`
- **Vue 3** —— `vue-page-scope@^0.1.0` · **Vue 3 host support is experimental in alpha**

> `vue-page-runtime` 自身不直接依赖 vue,它通过 host 在 install 时注入的 ctx 获取响应式能力。
> Vue 3 适配目前只过了最小 smoke,尚未在真实业务页面验证,请勿在生产依赖其稳定性。

---

## 接入(3 步)

**1. 全局注册一次**

Vue 2(`vue-page-store`):

```js
import { registerPlugin } from 'vue-page-store'
import taskPlugin from 'vue-page-runtime'

registerPlugin(taskPlugin)
```

Vue 3(`vue-page-scope`,experimental):

```js
import { registerPlugin } from 'vue-page-scope'
import taskPlugin from 'vue-page-runtime'

registerPlugin(taskPlugin)
```

两边 `registerPlugin(taskPlugin)` 写法完全一致,只是 `registerPlugin` 的来源不同。放在 `main.js` 顶部即可。

**2. 在 store 中声明 tasks**

```js
// stores/order-list.js
import { definePageStore } from 'vue-page-store'

export const useOrderStore = definePageStore('orderList', {
  source: () => ({ list: null, versionOptions: [] }),
  state: () => ({ keyword: '', productId: '' }),

  watch: {
    productId() {
      this.$task.run('loadVersionOptions')
    }
  },

  tasks: {
    search: {
      trigger: 'enter',
      async run ({ signal }) {
        this.$source.list = await api.search(this.keyword, { signal })
      }
    },
    loadVersionOptions: {
      trigger: 'manual',
      canRun () { return Boolean(this.productId) },
      reset () { this.$source.versionOptions = [] },
      async run ({ signal }) {
        this.$source.versionOptions = await api.getVersions({
          productId: this.productId
        }, { signal })
      }
    }
  }
})
```

**3. 模板里用**

```html
<el-button :loading="ps.$loading.search" @click="ps.$task.run('search')">
  搜索
</el-button>
```

---

## 核心三件套:trigger / canRun / reset

90% 的页面只需要这三个字段配合 `run`。

心智模型:

```
trigger → canRun → deps → run
```

| 字段 | 回答的问题 |
|---|---|
| `trigger` | 谁叫醒我 |
| `canRun` | 我现在能不能跑 |
| `deps` | 我跑之前要先跑谁(高级,大多数场景用不到) |
| `run` | 我正式执行 |
| `reset` | 我被 skip 时清理什么 |

### trigger

| 值 | 行为 |
|------|------|
| `'enter'` | **默认**。每次 mounted / activated 时执行 |
| `'init'` | 仅首次执行(keep-alive 切回时不重复) |
| `'manual'` | 不自动执行,只能通过 `$task.run(key)` 手动触发 |

### canRun

声明式资格判断。

```js
loadVersionOptions: {
  canRun () {
    return Boolean(this.filters.productId)
  },
  reset () {
    this.$source.versionOptions = []
  },
  async run ({ signal }) {
    this.$source.versionOptions = await api.getVersions({
      productId: this.filters.productId
    }, { signal })
  }
}
```

规则:

- 必须**同步**,返回 boolean
- 在 abort previous 之后、deps 之前评估
- 返回 false 时:不进 run、不开新 loading、不触发 onError;若声明了 reset,同步调用 reset

#### canRun 不是 watcher

这是常见误解。

`canRun` 不会自动监听它读取的字段。它只在 task 被唤起时执行。

```
错误理解:filters.productId 一变,runtime 自动重新评估 canRun,自动 run / reset
正确理解:你需要叫醒 task,canRun 才会被评估
```

字段变化仍然要靠 watch / UI 事件 / trigger 来叫醒:

```js
watch: {
  'filters.productId' () {
    this.$task.run('loadVersionOptions')
  }
}
```

但 watch 的职责变薄了:

```
改造前:watch 监听 + 判断 + 清理 + 请求
改造后:
  watch  只负责叫醒
  canRun 负责判断
  reset  负责清理
  run    负责请求
```

这是 0.2 的核心价值。

### reset

`reset` 在 task 被 skip 时同步触发。

skip 的来源:

1. 自己的 `canRun` 返回 false
2. 自己的某个 dep 被 skip

```js
reset () {
  this.$source.versionOptions = []
  this.$source.channelOptions = []
}
```

约束:

- 必须**同步**
- 必须**幂等**(反复调用结果应一致)
- 只做 self cleanup,**不发请求**,不做复杂副作用

**不触发 reset 的场景**:

| 场景 | 走哪 |
|---|---|
| `leave` / `destroy` | 只 abort,不 reset |
| `$task.abort()` 手动取消 | 只 abort,不 reset |
| `run` 抛错 | onError,不 reset |

reset 不是生命周期清理垃圾桶。它的语义只有一条:**本轮 task 无法产生有效结果,清掉自己的旧结果**。

---

## loading / abort

| 调用 | 行为 |
|------|------|
| `store.$task.run(key)` | 运行任务。**如已在运行,先 abort 再重新运行**。返回 Promise(skip 时 resolve `undefined`) |
| `store.$task.abort(key)` | 中断任务。不抛错 |
| `store.$loading[key]` | 响应式 boolean。运行中为 true,结束/中断/skip 后为 false |

### loading 与 canRun / deps 的关系

- `canRun` 返回 false:不开新 loading;但执行前会先 abort previous,旧 loading 会被结束
- 进入 deps 阶段:loading=true(此时哪怕在等 deps 也算运行中)
- dep 被 skip:loading=false

---

## 生命周期行为

```
mounted / activated
  └→ 首次:先跑所有 trigger === 'init' 的任务
  └→ 然后:跑所有 trigger === 'enter' 的任务

deactivated / beforeDestroy
  └→ abort 所有正在运行的任务(不调 reset)
```

---

## 高级:deps

> **如果你不确定要不要用 deps,大概率不要用。**

`deps` 表示当前 task 每次执行前,都要先执行的前置 task。

```
deps = run-before
```

不是 `ready-check`,不是 `once`,不是 `cache`,不是初始化资源检查。

### 适合的场景

只有这三种。

**1. 每次执行前都要 preflight**

```js
prepareExportTicket: {
  async run ({ signal }) {
    this.$source.exportTicket = await api.getExportTicket({ signal })
  }
},

exportExcel: {
  trigger: 'manual',
  deps: ['prepareExportTicket'],
  async run ({ signal }) {
    await api.exportExcel({ ticket: this.$source.exportTicket }, { signal })
  }
}
```

每次导出前都拿一次新 ticket。同类场景:`refreshToken` / `refreshPermissionContext` / `getTemporaryCredential` / `checkSession`。

**2. 后一个请求依赖前一个请求的本次新结果**

```js
loadDetailExtra: {
  deps: ['loadDetailBase'],
  async run ({ signal }) {
    this.$source.detailExtra = await api.getDetailExtra({
      relationId: this.$source.detailBase.relationId
    }, { signal })
  }
}
```

成立条件:`loadDetailExtra` 需要的是**本次** `loadDetailBase` 的最新结果。如果只是依赖已有状态,不要用 deps,用 canRun 判断状态是否存在。

**3. 多个 task 共享同一个每次都要跑的前置动作**

```js
loadSensitiveList:    { deps: ['refreshPermissionContext'], async run () {} },
exportSensitiveList:  { deps: ['refreshPermissionContext'], async run () {} }
```

把 run 里的 `await 前置动作()` 提升到声明层,谁依赖什么前置一目了然。

### 不适合的场景

**初始化字典 / 选项 / 首屏资源**(典型反例):

```js
// ❌ 错误:每次拉版本前都重新拉一遍产品列表
loadVersionOptions: {
  deps: ['loadProductOptions']
}

// ✅ 正确:用 canRun 判断 ready
loadVersionOptions: {
  canRun () {
    return this.$source.productOptionsLoaded &&
      Boolean(this.filters.productId)
  }
}
```

ready 是状态判断,不是执行依赖。

**永远绑定的串行请求**:

如果两个请求永远绑定且不复用,直接写在一个 task 的 run 里更清楚:

```js
loadPageData: {
  async run ({ signal }) {
    const base = await api.getBase({ signal })
    const extra = await api.getExtra({ id: base.id }, { signal })
    this.$source.base = base
    this.$source.extra = extra
  }
}
```

不要为了 deps 而 deps。

### 校验

0.2 在 install 时校验:

- `deps` 必须是数组 → 否则 throw
- `deps` 中的 key 必须存在于当前 tasks → 否则 throw

仍然不做:循环依赖检测、去重、DAG 调度。

### dep skipped 传播

deps 是硬依赖。任一 dep 被 skip,当前 task 也会被 skip(并触发自身 reset)。

```js
loadVersionOptions: {
  canRun () { return Boolean(this.filters.productId) },
  reset () { this.$source.versionOptions = [] },
  async run () {}
},

loadChannelOptions: {
  deps: ['loadVersionOptions'],
  reset () { this.$source.channelOptions = [] },
  async run () {}
}
```

`productId` 为空时:

```
$task.run('loadChannelOptions')
  ↓ run dep: loadVersionOptions
  ↓ canRun=false → reset + skip
  ↓ loadChannelOptions 检测到 dep skipped → reset + skip
  ↓ run 不执行
```

链路上一次声明 canRun,下游自动正确。

---

## 错误处理

**不**触发 onError:

- canRun 返回 false
- dep skipped
- abort
- reset 正常执行

触发 onError:

- canRun 抛错
- reset 抛错
- run 抛错

注:canRun / reset 应该是同步、简单、低风险的逻辑。如果它们抛错,说明用户代码有问题。

默认行为是打印到 `console.error`。需要自定义处理时,用 `taskPlugin.create(config)`:

```js
import { registerPlugin } from 'vue-page-store'
import taskPlugin from 'vue-page-runtime'

registerPlugin(taskPlugin.create({
  onError (error, key, host) {
    reportToSentry(error, { task: key, hostId: host.$id })
  }
}))
```

第三参 `host` 是当前运行宿主:在 `vue-page-store` 中是 store,在 `vue-page-scope` 中是 scope。`this` 在 `canRun` / `reset` / `run` 内同样指向该 host。

---

## 命名冲突

task 和 action 同名时,dev 环境会打印 warn:

```
[vue-page-runtime] task "search" has the same name as a function field on host. If this is an action, $loading.search may be shared.
```

因为 action 的 loading 和 task 的 loading 都写入 `store.$loading`,同名会相互覆盖。改一个名字即可。

---

## 完整示例

经典场景:列表页 + 上游筛选 → 下游版本选项级联。

```js
// stores/order-list.js
import { definePageStore } from 'vue-page-store'

export const useOrderStore = definePageStore('orderList', {
  source: () => ({
    list: null,
    productOptions: null,
    versionOptions: [],
  }),
  state: () => ({
    keyword: '',
    productId: '',
    versionId: '',
    page: 1,
  }),

  getters: {
    items () { return this.$source.list || [] }
  },

  watch: {
    // watch 只负责叫醒
    productId () {
      this.versionId = ''
      this.$task.run('loadVersionOptions')
    }
  },

  actions: {
    async batchDelete (ids) {
      await api.delete(ids)
      this.$task.run('search')
    }
  },

  tasks: {
    // 进入页面只跑一次:加载产品下拉选项
    loadProductOptions: {
      trigger: 'init',
      async run ({ signal }) {
        this.$source.productOptions = await api.getProductOptions({ signal })
      }
    },

    // 每次进入页面 + 用户主动搜索时跑
    search: {
      trigger: 'enter',
      async run ({ signal }) {
        this.$source.list = await api.search({
          keyword: this.keyword,
          productId: this.productId,
          versionId: this.versionId,
          page: this.page,
        }, { signal })
      }
    },

    // 产品变化时跑;没选产品就不跑 + 清空版本选项
    loadVersionOptions: {
      trigger: 'manual',
      canRun () { return Boolean(this.productId) },
      reset () { this.$source.versionOptions = [] },
      async run ({ signal }) {
        this.$source.versionOptions = await api.getVersions({
          productId: this.productId
        }, { signal })
      }
    },

    // 用户手动触发的导出
    exportExcel: {
      trigger: 'manual',
      async run ({ signal }) {
        await api.export({ keyword: this.keyword }, { signal })
      }
    }
  }
})
```

```html
<template>
  <div>
    <el-select v-model="ps.productId" :options="ps.$source.productOptions" />
    <el-select v-model="ps.versionId" :options="ps.$source.versionOptions" />

    <el-input v-model="ps.keyword" @change="ps.$task.run('search')" />

    <el-button :loading="ps.$loading.search" @click="ps.$task.run('search')">
      搜索
    </el-button>
    <el-button :loading="ps.$loading.exportExcel" @click="ps.$task.run('exportExcel')">
      导出
    </el-button>

    <el-table :data="ps.items" v-loading="ps.$loading.search" />
  </div>
</template>

<script>
import { useOrderStore } from './stores/order-list'

export default {
  created () {
    this.ps = useOrderStore(this)
  }
}
</script>
```

读这一段 tasks 配置就能回答:

- 这个页面进来跑哪些请求? → `loadProductOptions` (init) + `search` (enter)
- 哪些请求是用户操作触发的? → `search` (搜索按钮) / `exportExcel` (导出按钮) / `loadVersionOptions` (产品变化)
- 上游条件没满足时下游怎么办? → `loadVersionOptions.canRun` + `reset`
- 用户能怎么干预? → `actions.batchDelete` 走业务流程

不需要再读 `enter` / 其他散落代码。

---

## 设计边界

`vue-page-runtime` 只声明页面数据流,不接管远程数据状态。

它**不会**做:

- 缓存
- stale 判断
- retry
- debounce / throttle
- background refetch
- queryKey
- 返回值存储
- 自动提交数据
- 自动监听 canRun 依赖字段
- 循环依赖检测 / 去重 / DAG 调度

判断一个能力要不要做,只问一句:**它会让"读 tasks 就知道页面怎么跑"变得更清楚,还是更模糊?**

让数据流藏进缓存、隐式重试、后台同步或黑盒调度的能力,都不做。

---

## 设计原则

- **API 表面最小**:对外只有 `$task.run` / `$task.abort` / `$loading`
- **this 就是 store**:和 action 完全一致,零学习成本
- **action 与 task 职责分离**:action 是用户主动操作,task 是页面数据流
- **不做未来**:等真实案例再决定

---

## License

MIT
