import Vue from 'vue'
import { registerPlugin } from 'vue-page-store'
import taskPlugin from 'vue-page-runtime'
import App from './App.vue'
import { router } from './router.js'

// 全局注册一次任务编排插件
registerPlugin(taskPlugin)

Vue.config.productionTip = false

new Vue({
  router,
  render: (h) => h(App)
}).$mount('#app')
