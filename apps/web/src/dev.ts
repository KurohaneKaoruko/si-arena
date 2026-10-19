import { createApp, h } from "vue";
import DevPage from "./pages/DevPage.vue";
import "./style.css";

createApp({
  render: () =>
    h("main", { class: "mx-auto min-h-dvh w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14" }, [
      h(DevPage),
    ]),
}).mount("#app");
