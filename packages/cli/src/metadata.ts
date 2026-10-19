import { readFileSync } from "node:fs";

const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};
export const CLI_NAME = metadata.name;
export const CLI_VERSION = metadata.version;
declare const BUILD_DEFAULT_SERVER_URL: string;
// Replaced by the build; source tests and local builds default to loopback.
export const DEFAULT_SERVER_URL =
  typeof BUILD_DEFAULT_SERVER_URL === "string" ? BUILD_DEFAULT_SERVER_URL : "http://127.0.0.1:3000";
