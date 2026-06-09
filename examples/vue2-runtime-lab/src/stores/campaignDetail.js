/**
 * 详情页 store —— 第二个路由页。
 *
 * loadDetail 是 1500ms 慢请求，trigger:'enter'。用于：
 *   - 列表 → 详情 → 返回 的真实路由切换
 *   - 详情页未加载完就返回时，leave→abort 不污染
 *
 * 详情页每次进入用不同 id，故用 manual + 在 enter 时由页面用当前路由 id 触发，
 * 或直接 enter 自动（这里用 enter + currentId 状态）。
 */
import { definePageStore } from 'vue-page-store'
import * as api from '../mock/api.js'

export const useCampaignDetailStore = definePageStore('campaignDetail', {
  source: () => ({
    detail: null
  }),

  state: () => ({
    currentId: ''
  }),

  tasks: {
    // enter：进入详情页自动加载。canRun 守卫：没有 id 不加载。
    loadDetail: {
      trigger: 'enter',
      canRun () { return Boolean(this.currentId) },
      reset () { this.$source.detail = null },
      async run ({ signal }) {
        this.$source.detail = await api.fetchDetail(this.currentId, { signal })
      }
    }
  }
})
