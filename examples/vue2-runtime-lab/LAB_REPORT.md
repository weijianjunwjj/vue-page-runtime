# Vue2 Runtime Lab Report

第一份 `vue-page-runtime@0.2.0-alpha.1` 的真实页面级消费证据。全部数据虚拟、自编，
不含任何前公司 / 业务信息。

## 1. 验证环境

| 项 | 值 |
|---|---|
| Vue | 2.6.14（Lab 隔离安装；主包 node_modules 的 2.7.16 不受影响） |
| vue-router | 3.6.5（hash 模式） |
| vue-page-store（host） | 0.5.3（真实包） |
| vue-page-runtime | 0.2.0-alpha.1，本地 `file:` 引用 **tarball**（`npm pack` 产物），走 `main → dist/index.cjs.js` |
| runtime branch | `feat/host-adapter-0.2.0-alpha.1`（本地，未 push） |
| 隔离 | Lab 依赖全在 `examples/vue2-runtime-lab/node_modules`（gitignore）；主包 vue 三次快照恒为 2.7.16；vendor tarball / dist / node_modules 均 gitignore，未改主包 package.json / 构建 / runtime 5 commit |

引用方式选 tarball 的理由：最贴近真实 `npm install` —— 按 `package.files` 只含 dist+src，
装进 Lab 是普通目录、解析走 `main→dist`，**顺带验证了发布产物 main 入口在真实消费下正确**。

**如何复现**
```bash
# 1) 在仓库根生成 runtime tarball
npm run build && npm pack --pack-destination examples/vue2-runtime-lab/vendor
# 2) 安装 Lab 依赖（隔离）
npm install --prefix examples/vue2-runtime-lab
# 3) 真实页面（浏览器）
npm run dev   --prefix examples/vue2-runtime-lab   # http://localhost:5180
npm run build --prefix examples/vue2-runtime-lab   # 生产构建（已验证通过：21 modules transformed）
# 4) 无头取证（DOM 级断言）
npm run verify --prefix examples/vue2-runtime-lab   # 26 passed, 0 failed
```

> 取证方式：`npm run dev` 跑的 SFC 页面与 `verify/headless.mjs` 消费**同一份**
> `src/stores/*.js` 任务编排。headless 用 jsdom 真实挂载 Vue2 组件、绑定 `$loading` 到真实
> DOM、用 keep-alive 真实派发的 `hook:activated/deactivated` 驱动生命周期 —— 不是"再写脚本
> 断言替代页面"，而是给同一份被测对象换一个可在无头环境取证的视图层。

## 2. 验证场景（实际跑通的页面与任务）

两个路由页：
- `/campaigns` — 列表页（放进 `<keep-alive>`），store `campaignList`，7 个 task 中 6 个在此页
- `/campaigns/:id` — 详情页，store `campaignDetail`，1 个慢 task（1500ms）

Task 清单（≥4 要求，实际 7 个）：

| task | 页 | trigger | 特性 |
|---|---|---|---|
| initOptions | 列表 | init | 一次性加载筛选项 |
| fetchList | 列表 | enter | 列表查询、分页、搜索条件 |
| ownerStats | 列表 | manual | **canRun**(选了 owner 才跑) + **reset**(清空) |
| statusBreakdown | 列表 | manual | **deps:['ownerStats']**(正确用法)+ **reset** |
| updateItem | 列表 | manual | **canRun**(选中 item 才跑) + 成功后刷新列表 + 独立 loading |
| loadSummary | 列表 | manual | 1500ms 慢请求，用于 leave→abort |
| loadDetail | 详情 | enter | 1500ms 慢请求 + canRun(有 id 才跑) + reset |

headless 取证：**26 assertions / 26 passed / 0 failed**，覆盖 S1–S6。

## 3. Task 语义验证

| 语义 | 结论 | 证据（headless 场景） |
|---|---|---|
| **deps** | ✅ 正确用法成立：`statusBreakdown` 依赖 `ownerStats` 的**本次新结果**，owner 有值时按序产出 | S3 |
| **deps（反模式发现）** | ⚠️ 见第 6 节：把 init-once 的 options 当 deps 会每次重拉 —— runtime 行为与文档**一致**（deps=run-before, 每次跑），是 Lab 设计问题不是 runtime bug | S1/S2 修正前 |
| **canRun 跳过** | ✅ owner 空 → `ownerStats` run 不执行（无新请求）；`updateItem` 未选中 item 时跳过 | S3 |
| **reset 清理** | ✅ canRun=false 同步触发 reset，`ownerStats=null`；幂等 | S3 |
| **skip 传播** | ✅ `ownerStats` skip → `statusBreakdown`（依赖它）skip + 自身 reset，一处声明下游自动正确 | S3 |
| **多任务独立 loading** | ✅ `fetchList`/`loadSummary` 各自 key，先后完成互不串扰 | S4 |
| **init 一次性** | ✅ keep-alive 切回 init 不重复（fetchOptions 计数恒 1） | S2 |

## 4. 路由生命周期

| 生命周期 | 结论 | 证据 |
|---|---|---|
| enter（mounted/activated） | ✅ 进页面自动跑 init→enter；init 任务**先完成**再跑 enter 任务（见第 6 节延迟说明） | S1 |
| leave（deactivated） | ✅ 只 abort、loading 归零、不 reset、不 onError | S2/S5 |
| keep-alive activated | ✅ 重跑 enter、init 不重复 | S2 |
| destroy（beforeDestroy） | ✅ abort 所有运行中、$disposed=true、之后不再执行 | S6 |
| **慢请求 + route leave 防污染** | ✅ 离开列表页时未完成的 1500ms 慢请求返回后 `summary` 仍为 null，已加载 rows 未被误清 | S5 |
| **列表→详情→未完成即返回** | ✅ 详情慢请求经 destroy→abort 丢弃，detail 未写入 | S6 |

## 5. UI loading 验证（模板真实绑定）

- `$loading.fetchList / updateItem / loadSummary / loadDetail` 在 SFC 模板用 `:disabled` /
  `v-if` 真实绑定；headless 在 jsdom 里读真实 DOM（button `disabled` 属性、文本节点切换）。
- **真实 re-render 可靠**（S1）：`$loading` false→true→false 三态都驱动了 DOM 变化
  （button disabled 切换、`"loading list..." ↔ "rows:N"`）。这正是之前 Vue3 smoke 用
  `watch` 断言、**未经真实模板 re-render 验证**的盲区 —— 本 Lab 在真实 Vue2 渲染下补上了。
- **无污染 / 无残留**：多任务并发时各 loading 独立映射 DOM（S4）；canRun 跳过 / dep skip
  时不开新 loading、不残留（S3）；leave/abort 后 loading 立即归零（S5）。

## 6. 发现的问题

> 重申：**未发现 runtime bug**。runtime 在所有场景行为与 0.2 文档一致。以下是"设计自然度 /
> 接入心智"层面的真实发现。

### 6.1 deps 的反模式很容易踩（但文档已明确警告）
建 Lab 时的第一直觉是给 `fetchList` 写 `deps:['initOptions']`，让"列表查询前先确保选项就绪"。
结果：`initOptions` 既是 `trigger:'init'`、又被当成 dep —— **每次 fetchList 都重拉一遍 options**
（deps = run-before, 每次都跑）。这与 runtime 文档完全一致，README 也**明确警告**过这类用法
（"初始化字典/选项/首屏资源"应该用 `trigger:'init'` 或 `canRun` 的 ready 判断，不是 deps）。
- **是否 runtime bug**：否。行为即文档。
- **修正**：`fetchList` 去掉 deps；options 只是筛选下拉数据、并非列表查询的执行前置。
- **结论**：deps 的正确用法是"需要上游**本次新结果**"（如 `ownerStats→statusBreakdown`），
  不是"ready / once"。库的设计边界站得住，文档导向正确。**但 alpha 阶段值得在 README 把这个
  foot-gun 再加粗一次**（非阻断）。

### 6.2 init 阻塞 enter（延迟，非 bug）
plugin 的 enter 钩子会先 `await` 完**所有 init 任务**，再跑 enter 任务。于是首屏
`fetchList` 在 `initOptions`(700ms) 完成后才开始 —— 列表多等了一个 init 往返。
- 若 enter 确实依赖 init 的产物（token/权限上下文），这是**对的**。
- 若不依赖（本例 options 只喂筛选下拉、列表查询并不需要），就是纯延迟。
- **结论**：可接受、符合"先 init 后 enter"的文档描述；消费者若在意首屏，应避免把
  enter 不依赖的慢资源放进 init。值得在文档点一句"init 会阻塞 enter 开始"。

### 6.3 leave→abort 防污染 **依赖 run 透传 signal**（最重要的接入约束）
runtime 在 leave/destroy 时 abort controller，但它**只能**静默丢弃 run 的返回值与 loading；
**无法撤销 run 函数体内部已发生的副作用**。即：若 run 写成
`const r = await api.x(/* 不传 signal */); this.$source.y = r`，慢响应回来时那句赋值**照样执行**，
污染已离开页面。
- 防污染真正生效的前提：**run 必须把 `signal` 透传给可中断的 API**，让 abort 时 `await` 抛错、
  跳过后续赋值（Lab 的 mock 已 honor signal，故 S5/S6 通过）。
- **是否 runtime bug**：否，这是异步副作用的本质，任何编排库都无法代消费者撤销已执行语句。
- **结论**：这是 alpha 必须在文档**显著位置**强调的接入约束（目前 README 示例都传了 signal，
  但没把"不传 signal 则 abort 形同虚设"讲透）。

### 6.4 接入后是不是写了一堆胶水？
没有。页面数据流集中在 `tasks` 一处声明：进页面跑什么、什么条件跳过、跳过怎么清理、谁依赖谁，
读 `tasks` 一目了然。`watch`/`actions` 退化为"只负责叫醒"（`resetSearch` 改 state + `$task.run`，
`runOwnerChain` 触发两个 task）。canRun/reset 级联**省掉了手写的"清空旧选项"逻辑**。
轻微胶水：手动把"选 owner 后跑 ownerStats + statusBreakdown"写成两次 `$task.run`——可接受，
且语义清晰。净评价：**比散落在 enter/watch/actions 的写法更集中、更可读**。

## 7. 结论

### runtime 是否适合发 npm alpha
**适合（Vue2）。** 真实路由页面 + keep-alive + 慢请求/leave 场景全部跑通（26/26），0.2 语义
（trigger/canRun/reset/deps/skip/独立 loading/leave→abort）在真实页面与真实模板 re-render 下表现
与文档一致；接入后页面代码更集中而非胶水化。这是 alpha 该有的"有真实消费证据"状态。

### 是否需要先改 runtime
**不需要改代码 —— 未发现 runtime bug。** 仅有 3 条**文档**层面的增强建议（非阻断，可在 alpha
迭代里做）：
1. README 把 6.1 的 deps 反模式 foot-gun 再加粗（init-once/ready 用 canRun，不要用 deps）。
2. 文档点明 6.2"init 会阻塞 enter 开始"。
3. 文档**显著**强调 6.3"run 必须透传 signal，否则 leave→abort 防不住污染"。

### 是否有必要推进 Vue3 复杂场景
**有必要，但不阻断本次 alpha。** Vue2 已有真实页面证据；Vue3 目前仅过最小 smoke（基础链路 +
canRun/reset），复杂 deps / 多任务并发 / keep-alive 反复进出在 Vue3 下未验证。建议**后续**做一份
对等的 Vue3 真实页面 Lab（基于 vue-page-scope）再考虑把 Vue3 从 experimental 上调，**当前继续
标 experimental**。
