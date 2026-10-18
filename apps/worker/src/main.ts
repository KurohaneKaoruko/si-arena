import { SANDBOX_RUNTIME } from "@si-arena/sandbox";
import { readWorkerConfig } from "./config.js";

const config = readWorkerConfig();
console.log(
  JSON.stringify({
    service: "si-arena-worker",
    runtime: SANDBOX_RUNTIME,
    concurrency: config.concurrency,
    message: "Worker bootstrap ready. No match consumer or player-code executor is registered.",
  }),
);
