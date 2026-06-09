<template>
  <div class="page">
    <h2>Campaigns</h2>

    <!-- 筛选条件 -->
    <div class="toolbar">
      <input v-model="ps.keyword" placeholder="keyword" @keyup.enter="ps.$task.run('fetchList')" />
      <select v-model="ps.status">
        <option value="">(status)</option>
        <option v-for="o in ps.$source.options.status" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <select v-model="ps.owner">
        <option value="">(owner)</option>
        <option v-for="o in ps.$source.options.owner" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>

      <!-- 多个任务各自独立 loading，真实绑模板 -->
      <button :disabled="ps.$loading.fetchList" @click="ps.$task.run('fetchList')">
        {{ ps.$loading.fetchList ? 'querying…' : '查询' }}
      </button>
      <button @click="ps.resetSearch()">重置</button>
      <button :disabled="ps.$loading.ownerStats" @click="runOwnerChain()">owner 统计</button>
      <button :disabled="ps.$loading.loadSummary" @click="ps.$task.run('loadSummary')">
        {{ ps.$loading.loadSummary ? 'summary…(1.5s)' : '慢 summary' }}
      </button>
    </div>

    <div v-if="ps.$loading.fetchList" class="hint">loading list...</div>

    <!-- canRun/reset/skip 的可见结果 -->
    <div class="stats">
      <span>ownerStats: {{ ps.$source.ownerStats ? (ps.$source.ownerStats.owner + ' / ' + ps.$source.ownerStats.count) : '—' }}</span>
      <span> | statusBreakdown: {{ ps.$source.statusBreakdown ? JSON.stringify(ps.$source.statusBreakdown) : '—' }}</span>
      <span> | summary: {{ ps.$source.summary ? ps.$source.summary.total : '—' }}</span>
    </div>

    <table>
      <thead>
        <tr><th>id</th><th>name</th><th>status</th><th>owner</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in ps.$source.rows" :key="r.id" :class="{ sel: r.id === ps.selectedId }">
          <td>{{ r.id }}</td>
          <td><router-link :to="'/campaigns/' + r.id">{{ r.name }}</router-link></td>
          <td>{{ r.status }}</td>
          <td>{{ r.owner }}</td>
          <td>
            <button @click="ps.select(r.id)">选中</button>
            <button :disabled="ps.$loading.updateItem" @click="ps.$task.run('updateItem')">关闭</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="pager">
      <button :disabled="ps.page <= 1 || ps.$loading.fetchList" @click="prevPage()">上一页</button>
      <span>{{ ps.page }} / {{ ps.pageCount }}</span>
      <button :disabled="ps.page >= ps.pageCount || ps.$loading.fetchList" @click="nextPage()">下一页</button>
    </div>
  </div>
</template>

<script>
import { useCampaignListStore } from '../stores/campaignList.js'

export default {
  name: 'CampaignList',
  created () {
    this.ps = useCampaignListStore(this)
  },
  methods: {
    // owner 链：选了 owner 才出统计，否则 ownerStats skip → statusBreakdown skip + reset
    runOwnerChain () {
      this.ps.$task.run('ownerStats')
      this.ps.$task.run('statusBreakdown')
    },
    nextPage () {
      if (this.ps.page < this.ps.pageCount) {
        this.ps.page += 1
        this.ps.$task.run('fetchList')
      }
    },
    prevPage () {
      if (this.ps.page > 1) {
        this.ps.page -= 1
        this.ps.$task.run('fetchList')
      }
    }
  }
}
</script>

<style scoped>
.page { font-family: system-ui, sans-serif; padding: 12px; }
.toolbar { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.hint { color: #888; margin: 6px 0; }
.stats { font-size: 12px; color: #555; margin: 6px 0; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; font-size: 13px; }
tr.sel { background: #eef6ff; }
.pager { margin-top: 8px; display: flex; gap: 8px; align-items: center; }
button[disabled] { opacity: 0.5; cursor: not-allowed; }
</style>
