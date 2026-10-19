import { createApp, h } from "vue";
import DevPage from "./pages/DevPage.vue";
import "./style.css";

createApp({
  render: () =>
    h("main", { class: "mx-auto min-h-dvh max-w-6xl px-5 py-10 sm:px-8" }, [
      h("p", { class: "mb-10 font-mono text-sm text-arena-accent" }, "SI ARENA / LOCAL DEBUG"),
      h(DevPage),
    ]),
}).mount("#app");
