import { createApp, h } from "vue";
import DevPage from "./pages/DevPage.vue";
import "./style.css";

createApp({
  render: () => h("main", { class: "workspace min-h-dvh py-6" }, [h(DevPage)]),
}).mount("#app");
