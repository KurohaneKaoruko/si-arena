import { createApp, h } from "vue";
import ReplayPage from "./pages/ReplayPage.vue";
import "./style.css";

createApp({
  render: () =>
    h("main", { class: "mx-auto min-h-dvh w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14" }, [
      h(ReplayPage, {
        initialReplayUrl: "/replay.json.gz",
        exampleCommand: "pnpm arena run --bot ./bot.js --seed 42",
      }),
    ]),
}).mount("#app");
