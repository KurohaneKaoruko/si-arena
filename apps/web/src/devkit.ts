import { createApp, h } from "vue";
import ReplayPage from "./pages/ReplayPage.vue";
import "./style.css";

createApp({
  render: () =>
    h("main", { class: "workspace min-h-dvh py-6" }, [
      h(ReplayPage, {
        initialReplayUrl: "/replay.json.gz",
        exampleCommand: "pnpm arena run --bot ./bot.js --seed 42",
      }),
    ]),
}).mount("#app");
