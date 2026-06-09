/**
 * 列表页 store —— vue-page-runtime 任务编排的核心验证对象。
 *
 * 用 definePageStore + tasks 把"页面数据流"声明在一处。读这段 tasks 就能回答：
 *   - 进页面跑什么：initOptions(init 一次) → fetchList(enter, deps initOptions)
 *   - 用户操作触发什么：fetchList(查询) / updateItem(改状态) / ownerStats(选 owner)
 *   - 条件不满足怎么办：ownerStats.canRun + reset；statusBreakdown 依赖 ownerStats，
 *     owner 为空时整条链 skip + 各自 reset
 *   - 慢请求与离开：loadSummary(1500ms) 用于 leave→abort 验证
 *
 * 覆盖：deps 链 / canRun 跳过 / reset 清理 / skip 传播 / 多任务独立 loading。
 */
import { definePageStore } from 'vue-page-store'
import * as api from '../mock/api.js'

export const useCampaignListStore = definePageStore('campaignList', {
  source: () => ({
    options: { status: [], type: [], owner: [] },
    rows: [],
    total: 0,
    ownerStats: null,
    statusBreakdown: null,
    summary: null
  }),

  state: () => ({
    keyword: '',
    status: '',
    owner: '',
    page: 1,
    size: 10,
    selectedId: ''
  }),

  getters: {
    pageCount () {
      return Math.max(1, Math.ceil(this.$source.total / this.size))
    }
  },

  actions: {
    // 用户主动操作：重置筛选条件后重新查询。
    // 注意——这是 action（用户意图），不是 task。它只负责改 state + 叫醒 task。
    resetSearch () {
      this.keyword = ''
      this.status = ''
      this.owner = ''
      this.page = 1
      this.$task.run('fetchList')
      // owner 被清空 → ownerStats 链应在下次唤起时 skip + reset
      this.$task.run('statusBreakdown')
    },

    select (id) {
      this.selectedId = id
    }
  },

  tasks: {
    // 1) init：筛选项，只加载一次（keep-alive 切回不重复）
    initOptions: {
      trigger: 'init',
      async run ({ signal }) {
        this.$source.options = await api.fetchOptions({ signal })
      }
    },

    // 2) enter：列表查询。
    //    注意：这里【不】用 deps:['initOptions']。options 只是筛选下拉的数据，
    //    不是列表查询的执行前置；用 deps 会让每次查询都重拉一遍 options
    //    （deps = run-before，每次都跑）——这正是 README 明确警告的反模式。
    //    init-once 的资源用 trigger:'init' 加载即可，不该塞进 deps。
    fetchList: {
      trigger: 'enter',
      async run ({ signal }) {
        const res = await api.fetchList({
          keyword: this.keyword,
          status: this.status,
          owner: this.owner,
          page: this.page,
          size: this.size
        }, { signal })
        this.$source.rows = res.rows
        this.$source.total = res.total
      }
    },

    // 3) canRun + reset：选了 owner 才查统计；没选则跳过并清空旧统计
    ownerStats: {
      trigger: 'manual',
      canRun () { return Boolean(this.owner) },
      reset () { this.$source.ownerStats = null },
      async run ({ signal }) {
        const res = await api.fetchList({ owner: this.owner, size: 999 }, { signal })
        this.$source.ownerStats = { owner: this.owner, count: res.total }
      }
    },

    // 4) skip 传播：依赖 ownerStats。owner 为空 → ownerStats skip → 本任务 skip + reset
    statusBreakdown: {
      trigger: 'manual',
      deps: ['ownerStats'],
      reset () { this.$source.statusBreakdown = null },
      async run ({ signal }) {
        const res = await api.fetchList({ owner: this.owner, size: 999 }, { signal })
        const by = {}
        res.rows.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1 })
        this.$source.statusBreakdown = by
      }
    },

    // 5) 独立 loading + canRun 守卫（没选中 item 就跳过）+ 成功后刷新列表
    updateItem: {
      trigger: 'manual',
      canRun () { return Boolean(this.selectedId) },
      async run ({ signal }) {
        await api.updateStatus(this.selectedId, 'closed', { signal })
        // 成功后衔接刷新列表（手动触发，独立 loading 不互相污染）
        await this.$task.run('fetchList')
      }
    },

    // 6) 慢请求（1500ms）：用于 route leave / keep-alive 离开时的 abort 防污染验证
    loadSummary: {
      trigger: 'manual',
      async run ({ signal }) {
        const res = await api.fetchSummary({}, { signal })
        this.$source.summary = res
      }
    }
  }
})
