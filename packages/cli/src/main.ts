#!/usr/bin/env node
import { runCli } from "./commands";

if (Number(process.versions.node.split(".")[0]) < 26) {
  console.error("SI Arena requires Node.js 26 or newer.");
  process.exitCode = 1;
} else {
  const cancellation = new AbortController();
  const stop = () => cancellation.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runCli(process.argv.slice(2), { signal: cancellation.signal });
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "error",
        message: error instanceof Error ? error.message : "Local operation failed",
      }),
    );
    process.exitCode = cancellation.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
