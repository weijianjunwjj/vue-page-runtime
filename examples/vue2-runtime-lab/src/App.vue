<template>
  <div id="lab">
    <nav class="nav">
      <router-link to="/campaigns">列表</router-link>
      <span class="muted"> · keep-alive 包裹列表页</span>
    </nav>
    <!-- 列表页放进 keep-alive：验证 activated/deactivated + init 不重复 -->
    <keep-alive include="CampaignList">
      <router-view />
    </keep-alive>
  </div>
</template>

<script>
export default { name: 'App' }
</script>

<style>
#lab { max-width: 920px; margin: 0 auto; }
.nav { padding: 10px 12px; border-bottom: 1px solid #eee; }
.nav a { margin-right: 10px; }
.muted { color: #999; font-size: 12px; }
</style>
