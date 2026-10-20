import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readReplayFile } from "@si-arena/engine/node";
import { checkCancelled, ENGINE_COMPATIBILITY, type LocalGameRegistration } from "./local-game";
import { CLI_NAME, CLI_VERSION } from "./metadata";
import { initializeGame } from "./init";
import { serveDev } from "./dev";
import { serveReplay } from "./viewer";

const HELP = `SI Arena CLI

Usage:
  arena init <gameId> <directory> [--server <url>] [--release <releaseId>]
  arena --registry ./arena.config.mjs run --bot ./bot.js [options]
  arena --registry ./arena.config.mjs replay ./replays/match.json.gz --verify [--logs]
  arena replay ./replays/match.json.gz  (standalone development package viewer)
  arena dev --bot ./bot.js [--opponent <file>] [--seed <uint32>]  (standalone development package debug page)

Options:
  --server <url>     Platform origin (HTTP or HTTPS)
  --release <id>     Download a fixed historical release
  --registry <file>  Explicitly trust and load a local game registration module
  --game <id>        Select a registered game (optional with one game)
  --bot <file>       Player JavaScript source, executed only in QuickJS
  --opponent <file>  Local opponent (repeatable); default: official bot(s)
  --matches <n>      Sequential matches, 1–1000 (default: 1)
  --seed <uint32>    First seed; increment with uint32 wrap (default: 42)
  --out <directory>  Replay directory (default: ./replays)
  --verify          Verify replay without executing bots
  --logs            Print verified replay logs, errors and truncation markers
  -h, --help        Show help
  -v, --version     Show version

Results are JSON Lines. Local runs use the registered release limits.
Registry modules are trusted host code; never register a player bot as a module.
`;

export interface CliContext {
  cwd?: string;
  games?: readonly LocalGameRegistration[];
  write?: (line: string) => void;
  signal?: AbortSignal;
  viewerDirectory?: string;
}

/** Throws on invalid input/system failure; player tick errors remain ordinary match results. */
export async function runCli(args: string[], context: CliContext = {}): Promise<void> {
  const cwd = context.cwd ?? process.cwd();
  const write = context.write ?? ((line: string) => console.log(line));
  const output = (record: unknown) => write(JSON.stringify(record));
  const { values, positionals, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      registry: { type: "string" },
      server: { type: "string" },
      release: { type: "string" },
      game: { type: "string" },
      bot: { type: "string" },
      opponent: { type: "string", multiple: true },
      matches: { type: "string" },
      seed: { type: "string" },
      out: { type: "string" },
      verify: { type: "boolean" },
      logs: { type: "boolean" },
    },
  });
  if (values.version) return write(`${CLI_NAME} ${CLI_VERSION}`);
  if (values.help || positionals.length === 0) return write(HELP);
  const command = positionals[0];
  if (command !== "run" && command !== "replay" && command !== "init" && command !== "dev")
    throw new Error(`Unknown command: ${command ?? "(missing)"}. Run arena --help.`);
  const allowed = new Set(
    command === "init"
      ? ["server", "release"]
      : [
          "registry",
          "game",
          ...(command === "run"
            ? ["bot", "opponent", "matches", "seed", "out"]
            : command === "dev"
              ? ["bot", "opponent", "seed"]
              : ["verify", "logs"]),
        ],
  );
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (!allowed.has(token.name)) throw new Error(`--${token.name} is not valid for ${command}`);
    if (seen.has(token.name) && token.name !== "opponent")
      throw new Error(`Duplicate option: --${token.name}`);
    seen.add(token.name);
  }
  if (command === "init") {
    if (positionals.length !== 3)
      throw new Error(
        "Usage: arena init <gameId> <directory> [--server <url>] [--release <releaseId>]",
      );
    const result = await initializeGame({
      gameId: positionals[1]!,
      directory: positionals[2]!,
      cwd,
      ...(values.server ? { server: values.server } : {}),
      ...(values.release ? { release: values.release } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    output({
      type: "initialized",
      ...result,
      next: [
        "pnpm install --frozen-lockfile",
        "pnpm arena run --bot ./bot.js",
        "pnpm arena replay <replay.json.gz>",
      ],
    });
    return;
  }
  if (command === "run" && (positionals.length !== 1 || !values.bot))
    throw new Error("Usage: arena run --bot <file> [options]");
  if (command === "dev" && (positionals.length !== 1 || !values.bot))
    throw new Error("Usage: arena dev --bot <file> [options]");
  if (command === "replay" && (positionals.length !== 2 || (values.logs && !values.verify)))
    throw new Error("Usage: arena replay <file.json.gz> --verify [--logs]");
  if (command === "replay" && !values.verify) {
    if (!context.viewerDirectory)
      throw new Error(
        "Use --verify for terminal verification, or open the replay with a standalone development package",
      );
    await serveReplay({
      directory: context.viewerDirectory,
      replay: resolve(cwd, positionals[1]!),
      write,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    return;
  }
  const matches = integerOption(values.matches ?? "1", 1, 1000, "matches");
  const firstSeed = integerOption(values.seed ?? "42", 0, 0xffffffff, "seed");
  checkCancelled(context.signal);
  if (values.registry && context.games)
    throw new Error("Use either injected registrations or --registry, not both");
  const games =
    context.games ?? (values.registry ? await loadRegistry(resolve(cwd, values.registry)) : []);
  validateRegistry(games);
  const game = values.game
    ? games.find((entry) => entry.manifest.id === values.game)
    : games.length === 1
      ? games[0]
      : undefined;
  if (!game) throw new Error("Select a registered game with --game <id>");
  const release = {
    id: game.manifest.id,
    release: game.manifest.release,
    botProtocolVersion: game.manifest.botProtocolVersion,
    engineCompatibility: ENGINE_COMPATIBILITY,
  };
  if (command === "replay") {
    const path = resolve(cwd, positionals[1]!);
    const raw = await readReplayFile(path);
    const { diagnostics, ...summary } = await game.verify(raw, {
      diagnostics: values.logs ?? false,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    for (const diagnostic of diagnostics) output({ type: "diagnostic", ...diagnostic });
    output({ type: "replay", game: release, replay: path, verified: true, ...summary });
    return;
  }
  const paths = [values.bot!, ...(values.opponent ?? [])].map((path) => resolve(cwd, path));
  if (command === "dev") {
    const directory = context.viewerDirectory;
    if (!directory) throw new Error("The dev debug page requires a standalone development package");
    await serveDev({
      directory,
      registration: game,
      botPaths: paths,
      seed: firstSeed,
      write,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    return;
  }
  const prepared = await game.prepare(paths, context.signal);
  output({
    type: "release",
    game: release,
    resolvedLimits: game.manifest.resolvedLimits,
    isolation: { kind: "local", processMemoryEnforced: false },
    players: prepared.players,
  });
  const directory = resolve(cwd, values.out ?? "replays");
  const tally = { wins: 0, draws: 0, losses: 0 };
  let errorCount = 0;
  for (let index = 0; index < matches; index++) {
    checkCancelled(context.signal);
    const seed = (firstSeed + index) >>> 0;
    const path = join(
      directory,
      `match-${String(index + 1).padStart(4, "0")}-seed-${seed}-${randomUUID()}.json.gz`,
    );
    const summary = await prepared.run({
      seed,
      replay: path,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const self = summary.result.players.find((player) => player.id === "bot")!;
    if (self.rank !== 1) tally.losses++;
    else if (summary.result.players.some((player) => player.id !== "bot" && player.rank === 1))
      tally.draws++;
    else tally.wins++;
    errorCount += summary.errorCount;
    output({ type: "match", index: index + 1, seed, replay: path, ...summary });
  }
  output({ type: "batch", matches, firstSeed, ...tally, errorCount, replayDirectory: directory });
}

function integerOption(raw: string, min: number, max: number, name: string): number {
  if (
    !/^(0|[1-9]\d*)$/.test(raw) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) < min ||
    Number(raw) > max
  )
    throw new Error(`--${name} must be an integer between ${min} and ${max}`);
  return Number(raw);
}

async function loadRegistry(path: string): Promise<readonly LocalGameRegistration[]> {
  // This path is supplied explicitly by the user, never by a replay or player source.
  const loaded: unknown = (await import(pathToFileURL(path).href)).default;
  if (!Array.isArray(loaded))
    throw new Error("Registry must default-export an array of defineLocalGame registrations");
  return loaded as LocalGameRegistration[];
}

function validateRegistry(games: readonly LocalGameRegistration[]): void {
  if (!games.length)
    throw new Error("No games registered. Supply --registry <trusted-local-module>.");
  const ids = new Set<string>();
  for (const game of games) {
    if (
      !game?.manifest ||
      typeof game.manifest.id !== "string" ||
      !game.manifest.id ||
      typeof game.prepare !== "function" ||
      typeof game.verify !== "function"
    )
      throw new Error("Invalid local game registration");
    if (ids.has(game.manifest.id))
      throw new Error(`Duplicate registered game: ${game.manifest.id}`);
    ids.add(game.manifest.id);
  }
}
