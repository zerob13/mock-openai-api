import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Button, Loading } from '@varlet/ui'
import '@varlet/ui/es/button/style/index.mjs'
import '@varlet/ui/es/loading/style/index.mjs'
import App from './App.vue'
import router from './router'
import './styles.css'

createApp(App).use(createPinia()).use(router).use(Button).use(Loading).mount('#app')
