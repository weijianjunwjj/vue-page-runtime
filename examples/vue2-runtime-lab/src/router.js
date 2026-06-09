import Vue from 'vue'
import VueRouter from 'vue-router'
import CampaignList from './pages/CampaignList.vue'
import CampaignDetail from './pages/CampaignDetail.vue'

Vue.use(VueRouter)

export const router = new VueRouter({
  mode: 'hash',
  routes: [
    { path: '/', redirect: '/campaigns' },
    { path: '/campaigns', component: CampaignList },
    { path: '/campaigns/:id', component: CampaignDetail }
  ]
})
