# vue-page-runtime

> vue-page-store 的任务编排插件 —— 在 `definePageStore` 中声明 `tasks`，获得**自动运行 / 依赖顺序 / loading / abort**。

## 它做什么

声明 `tasks` 字段 → 获得三件事：

1. 按 `trigger` 自动运行
2. 依赖顺序（`deps`）
3. `$loading[key]` 响应式状态 + `$task.run()` / `$task.abort()` 手动控制

**仅此而已。**

这一版刻意保持最小。错误状态、重试、返回值存储、缓存、debounce、DAG 调度等能力**都不做**。

## 安装

```bash
npm install vue-page-runtime
```

要求：

- `vue@^2.6.0`
- `vue-page-store@^0.5.0`

## 接入（3 步）

**1. 全局注册一次**

```js
import { registerPlugin } from 'vue-page-store'
import taskPlugin from 'vue-page-runtime'

registerPlugin(taskPlugin)
```

放在 `main.js` 顶部即可。如果项目之后会接多个 page-store 插件，建议抽到 `src/stores/runtime.js` 集中管理，然后 `main.js` 里 `import './stores/runtime'` 一行。

**2. 在 store 中声明 tasks**

```js
// stores/order-list.js
import { definePageStore } from 'vue-page-store'

export const useOrderStore = definePageStore('orderList', {
  source: () => ({ list: null }),
  state: () => ({ keyword: '' }),

  tasks: {
    search: {
      trigger: 'enter',
      async run ({ signal }) {
        this.$source.list = await api.search(this.keyword, { signal })
      }
    }
  }
})
```

**3. 模板里用**

```html
<el-button
  :loading="ps.$loading.search"
  @click="ps.$task.run('search')"
>
  搜索
</el-button>
```

页面进入自动跑 `search`，页面离开自动 abort。

---

## tasks 配置

```js
tasks: {
  taskName: {
    run ({ signal }) {},    // 必填。this = store
    trigger: 'enter',        // 'enter' | 'init' | 'manual'，默认 'enter'
    deps: [],                // 依赖的其他 task key
  }
}
```

### run

```js
async run ({ signal }) {
  // this = store，可以访问所有 state / source / getters / actions
  const data = await api.fetch(this.keyword, { signal })
  this.$source.list = data
}
```

**必须接收 `{ signal }`。** 把它传给支持 AbortController 的请求库（fetch、axios v0.22+ 等），这样 abort 能真正打断请求。

**返回值目前不使用。** 如果需要在任务间传递数据，用 `this.$source.xxx = result` 写到 source 里。

### trigger

| 值 | 行为 |
|------|------|
| `'enter'` | **默认**。每次 mounted / activated 时执行 |
| `'init'` | 仅首次执行（keep-alive 切回时不重复） |
| `'manual'` | 不自动执行，只能通过 `$task.run(key)` 手动触发 |

### deps

**`deps` 只支持其他 task key。** 不支持 action 名、getter 名、state 路径、函数。

```js
tasks: {
  fetchUser: {
    trigger: 'enter',
    async run () { this.$source.user = await api.getUser() }
  },
  fetchOrders: {
    deps: ['fetchUser'],
    async run () {
      this.$source.orders = await api.getOrders(this.$source.user.id)
    }
  }
}
```

规则：

- `fetchOrders` 运行时会先等 `fetchUser` 完成
- 无依赖的任务之间并行
- **0.1 不做循环依赖检测**，请自己保证 deps 不成环
- **0.1 不做去重**，多个任务依赖同一个 task 时，该 task 可能被多次调用

---

## API

| 调用 | 行为 |
|------|------|
| `store.$task.run(key)` | 运行任务。**如已在运行，先 abort 再重新运行**。返回 Promise |
| `store.$task.abort(key)` | 中断任务。不抛错 |
| `store.$loading[key]` | 响应式 boolean。运行中为 true，结束/中断后为 false |

**没有别的。** 不暴露 `$error`、`$data`、`$task.xxx.loading` 等。保持 API 表面最小。

---

## 生命周期行为

```
mounted / activated
  └→ 首次：先跑所有 trigger === 'init' 的任务
  └→ 然后：跑所有 trigger === 'enter' 的任务

deactivated / beforeDestroy
  └→ abort 所有正在运行的任务
```

---

## 错误处理

默认：失败时打印到 `console.error`。

需要自定义处理时，用 `taskPlugin.create(config)`：

```js
import { registerPlugin } from 'vue-page-store'
import taskPlugin from 'vue-page-runtime'

registerPlugin(taskPlugin.create({
  onError (error, key, store) {
    // 上报 / 提示 / 记录
    reportToSentry(error, { task: key, storeId: store.$id })
  }
}))
```

**abort 不会触发 onError。** 主动取消的任务视为正常结束。

---

## 命名冲突

task 和 action 同名时，dev 环境会打印 warn：

```
[vue-page-runtime] task "search" has the same name as an action.
```

因为 action 的 loading 和 task 的 loading 都写入 `store.$loading`，同名会相互覆盖。改一个名字即可。

---

## 完整示例

```js
// stores/order-list.js
import { definePageStore } from 'vue-page-store'

export const useOrderStore = definePageStore('orderList', {
  source: () => ({
    list: null,
    dict: null,
  }),
  state: () => ({
    keyword: '',
    page: 1,
  }),

  getters: {
    items () { return this.$source.list || [] }
  },

  actions: {
    async batchDelete (ids) {
      await api.delete(ids)
      this.$task.run('search')
    }
  },

  tasks: {
    loadDict: {
      trigger: 'init',
      async run ({ signal }) {
        this.$source.dict = await api.getDict({ signal })
      }
    },
    search: {
      trigger: 'enter',
      async run ({ signal }) {
        this.$source.list = await api.search({
          keyword: this.keyword,
          page: this.page,
        }, { signal })
      }
    },
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
    <el-input v-model="ps.keyword" @change="ps.$task.run('search')" />

    <el-button
      :loading="ps.$loading.search"
      @click="ps.$task.run('search')"
    >搜索</el-button>

    <el-button
      :loading="ps.$loading.exportExcel"
      @click="ps.$task.run('exportExcel')"
    >导出</el-button>

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

---

## 设计原则

- **API 表面最小。** 只有 `$task.run` / `$task.abort` / `$loading`。
- **action 和 task 职责分离。** action 是用户触发的操作，task 是页面自己要跑的数据请求。
- **不做未来。** 没有 retry、没有缓存、没有 DAG、没有 Effect System。等实战反馈再决定是否加。
- **this 就是 store。** 和 action 完全一致，零学习成本。

## 发布策略

0.1 **直接分发源码**，不打包。`package.json` 的 `main` / `module` / `exports` 都指向 `src/index.js`。

理由：

- 代码是纯 ES5 + ES2015（`var` + Promise），Vue 2.6 支持的环境都能直接跑
- 单文件 200 行，打包的复杂度不值得
- 用户调试时看到的就是源码，没有 sourcemap 的烦恼

未来如果代码里出现需要转译的语法、需要 dev-only 代码剔除、或需要 UMD 格式，再引入构建产物。

---

## License

MIT
