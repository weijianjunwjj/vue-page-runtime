<template>
  <div class="page">
    <h2>Campaign Detail</h2>
    <router-link to="/campaigns">← 返回列表</router-link>

    <div v-if="ds.$loading.loadDetail" class="hint">loading detail…(1.5s slow)</div>

    <div v-if="ds.$source.detail" class="detail">
      <p><b>id:</b> {{ ds.$source.detail.id }}</p>
      <p><b>name:</b> {{ ds.$source.detail.name }}</p>
      <p><b>status:</b> {{ ds.$source.detail.status }}</p>
      <p><b>owner:</b> {{ ds.$source.detail.owner }}</p>
      <p><b>description:</b> {{ ds.$source.detail.description }}</p>
    </div>
    <div v-else-if="!ds.$loading.loadDetail" class="hint">no detail</div>
  </div>
</template>

<script>
import { useCampaignDetailStore } from '../stores/campaignDetail.js'

export default {
  name: 'CampaignDetail',
  created () {
    this.ds = useCampaignDetailStore(this)
    // 用当前路由 id 驱动 enter 加载
    this.ds.currentId = this.$route.params.id
    // enter 钩子会在 mounted 时触发 loadDetail（canRun 依赖 currentId，已先赋值）
  },
  watch: {
    '$route.params.id' (id) {
      this.ds.currentId = id
      this.ds.$task.run('loadDetail')
    }
  }
}
</script>

<style scoped>
.page { font-family: system-ui, sans-serif; padding: 12px; }
.hint { color: #888; margin: 6px 0; }
.detail p { margin: 4px 0; font-size: 14px; }
</style>
