import { readFile } from "node:fs/promises";

const marker = "<!-- SI_ARENA_RESEARCH -->";

/** The website and ZIP builder use the same complete, standalone prompt. */
export async function readDevelopmentMaterials(files: { prompt: URL; sdk: URL; template: URL }) {
  const [prompt, research, sdk, template] = await Promise.all([
    readFile(files.prompt, "utf8"),
    readFile(new URL("../RESEARCH.md", import.meta.url), "utf8"),
    readFile(files.sdk, "utf8"),
    readFile(files.template, "utf8"),
  ]);
  if (prompt.split(marker).length !== 2)
    throw new Error("Game prompt must contain exactly one research marker");
  return { prompt: prompt.replace(marker, () => research.trimEnd()), sdk, template };
}

export { publishDevkit, readDevkit } from "./store";
