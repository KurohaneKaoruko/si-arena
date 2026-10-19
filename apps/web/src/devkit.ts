import { createApp, h } from "vue";
import ReplayPage from "./pages/ReplayPage.vue";
import "./style.css";

createApp({
  render: () =>
    h("main", { class: "mx-auto min-h-dvh max-w-6xl px-5 py-10 sm:px-8" }, [
      h("p", { class: "mb-10 font-mono text-sm text-arena-accent" }, "SI ARENA / LOCAL REPLAY"),
      h(ReplayPage, {
        initialReplayUrl: "/replay.json.gz",
        exampleCommand: "pnpm arena run --bot ./bot.js --seed 42",
      }),
    ]),
}).mount("#app");
