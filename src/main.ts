import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";
import { useAppStore } from "./stores/app";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
useAppStore(pinia);
app.mount("#app");
