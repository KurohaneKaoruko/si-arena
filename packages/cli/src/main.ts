#!/usr/bin/env node
import { parseArgs } from "node:util";
import { CLI_NAME, CLI_VERSION } from "./index.js";

if (Number(process.versions.node.split(".")[0]) < 26) {
  console.error("SI Arena requires Node.js 26 or newer.");
  process.exitCode = 1;
} else {
  const { values, positionals } = parseArgs({
    options: { help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } },
    allowPositionals: true,
  });
  if (values.version) {
    console.log(`${CLI_NAME} ${CLI_VERSION}`);
  } else if (values.help || positionals.length === 0) {
    console.log(`SI Arena CLI

Usage: arena [options]

Options:
  -h, --help     Show help
  -v, --version  Show version`);
  } else {
    console.error(`Unknown command: ${positionals[0]}. Run arena --help.`);
    process.exitCode = 1;
  }
}
