import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  cloneJson,
  freezeJson,
  type DeepReadonly,
  type ExecutionError,
  type GameCatalogEntry,
  type JsonObject,
  type JsonValue,
  type PlayerLog,
  type Replay,
} from "@si-arena/protocol";
import {
  ENGINE_COMPATIBILITY,
  replayMatch,
  type GameDefinition,
  type ReplayFooter,
  type ReplayPlayer,
  type ReplayTick,
} from "@si-arena/engine";
import { runMatchProcess, validateSource, type GameModule } from "@si-arena/runner";

export type LocalDiagnostic = { tick: number; playerId: string } & (
  | { kind: "log"; log: PlayerLog }
  | { kind: "error"; error: ExecutionError }
  | { kind: "logs-truncated" }
);
export interface LocalSummary extends ReplayFooter {
  matchId: string;
  errorCount: number;
  logCount: number;
  truncatedTicks: number;
}
export interface PreparedLocalMatch {
  readonly players: readonly Readonly<ReplayPlayer>[];
  run(options: {
    seed: number;
    /** Persisted gzip replay path; omit to keep the replay in memory as replayData. */
    replay?: string;
    signal?: AbortSignal;
    /** Committed Memory observed after each player executor outcome (live debug sessions). */
    onMemory?(playerId: string, tick: number, memory: JsonObject): void;
    /** Notified with the number of completed ticks after each tick. */
    onTick?(completedTicks: number): void;
    onMemoryTruncated?(): void;
  }): Promise<LocalSummary & { replayData?: Readonly<Replay<unknown, unknown>> }>;
}
/** Trusted registrations are executable host code, separate from player source and replay data. */
export interface LocalGameRegistration {
  readonly manifest: DeepReadonly<GameCatalogEntry>;
  prepare(botPaths: readonly string[], signal?: AbortSignal): Promise<PreparedLocalMatch>;
  verify(
    raw: unknown,
    options?: { signal?: AbortSignal; diagnostics?: boolean },
  ): Promise<LocalSummary & { diagnostics: LocalDiagnostic[] }>;
}

const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

/** A closure preserves each game's type parameters without coupling the CLI to any game. */
export function defineLocalGame<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(options: {
  game: GameDefinition<State, Observation, Action, Event>;
  officialBotUrl: URL;
  module: GameModule;
}): LocalGameRegistration {
  const { game, officialBotUrl } = options;
  const manifest = freezeJson(cloneJson(game.manifest));
  return {
    manifest,
    async prepare(botPaths, signal) {
      checkCancelled(signal);
      if (!botPaths.length) throw new Error("At least one local bot file is required");
      // A lone bot meets official bots: a full arena for arena games, else the minimum.
      const count =
        botPaths.length === 1 ? (manifest.arena?.seats ?? manifest.minPlayers) : botPaths.length;
      if (count < manifest.minPlayers || count > manifest.maxPlayers)
        throw new Error(`Game requires ${manifest.minPlayers}–${manifest.maxPlayers} players`);
      const inputs = Array.from({ length: count }, (_, slot) => {
        const path = botPaths[slot];
        const official = path === undefined;
        return {
          path: path ?? officialBotUrl,
          player: {
            id: slot === 0 ? "bot" : official ? `official-${slot}` : `opponent-${slot}`,
            slot,
            name: official ? "Official" : basename(path!),
            official,
          },
        };
      });
      // Freeze source texts once per invocation, deduplicating official opponents.
      const sources = await Promise.all(
        inputs.map((input) => readBotSource(input.path, manifest.resolvedLimits.codeBytes)),
      );
      const unique = [...new Set(sources)];
      for (let index = 0; index < unique.length; index += 2) {
        checkCancelled(signal);
        await Promise.all(
          unique.slice(index, index + 2).map(async (source) => {
            const validation = await validateSource({
              source,
              limits: cloneJson(manifest.resolvedLimits),
              isolation: { kind: "local" },
            });
            if (!validation.ok)
              throw new Error(
                `${inputs[sources.indexOf(source)]!.player.id}: ${validation.error.type}: ${validation.error.message}`,
              );
          }),
        );
      }
      checkCancelled(signal);
      const players = freezeJson(inputs.map((input) => input.player));
      return {
        players,
        async run({ seed, replay, signal: matchSignal, onMemory, onTick, onMemoryTruncated }) {
          return runMatchProcess({
            module: options.module,
            manifest: cloneJson(manifest) as GameCatalogEntry,
            matchId: `local-${randomUUID()}`,
            players: cloneJson(players) as ReplayPlayer[],
            sources,
            seed,
            captureLogs: true,
            isolation: { kind: "local" },
            ...(replay ? { replayPath: replay } : {}),
            ...(matchSignal ? { signal: matchSignal } : {}),
            ...(onMemory ? { onMemory } : {}),
            ...(onTick ? { onTick } : {}),
            ...(onMemoryTruncated ? { onMemoryTruncated } : {}),
          });
        },
      };
    },
    async verify(raw, settings = {}) {
      checkCancelled(settings.signal);
      raw = cloneJson(raw, MAX_REPLAY_BYTES);
      const stats = counters();
      const diagnostics: LocalDiagnostic[] = [];
      const summary = await replayMatch(raw, game, {
        detached: true,
        maxBytes: MAX_REPLAY_BYTES,
        onTick({ record }) {
          checkCancelled(settings.signal);
          stats.add(record);
          if (settings.diagnostics) {
            for (const [playerId, error] of Object.entries(record.errors ?? {}))
              diagnostics.push({
                kind: "error",
                tick: record.tick,
                playerId,
                error: cloneJson(error),
              });
            for (const [playerId, logs] of Object.entries(record.logs ?? {}))
              for (const log of logs)
                diagnostics.push({ kind: "log", tick: record.tick, playerId, log: cloneJson(log) });
            for (const playerId of Object.keys(record.logsTruncated ?? {}))
              diagnostics.push({ kind: "logs-truncated", tick: record.tick, playerId });
          }
        },
      });
      checkCancelled(settings.signal);
      // Only return diagnostics after the final result and state hash have been verified.
      const matchId = (raw as { matchId: string }).matchId;
      return {
        matchId,
        result: summary.result,
        finalStateHash: summary.finalStateHash,
        ...stats.value,
        diagnostics,
      };
    },
  };
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Local operation cancelled");
}

function counters() {
  const value = { errorCount: 0, logCount: 0, truncatedTicks: 0 };
  return {
    value,
    add(record: DeepReadonly<ReplayTick<unknown>>) {
      value.errorCount += Object.keys(record.errors ?? {}).length;
      value.logCount += Object.values(record.logs ?? {}).reduce(
        (sum, logs) => sum + logs.length,
        0,
      );
      if (Object.keys(record.logsTruncated ?? {}).length) value.truncatedTicks++;
    },
  };
}

async function readBotSource(path: string | URL, maxBytes: number): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Bot source must be a regular file");
    if (stat.size > maxBytes) throw new Error(`Bot source exceeds ${maxBytes} bytes`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size <= maxBytes) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error(`Bot source exceeds ${maxBytes} bytes`);
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } finally {
    await file.close();
  }
}

export { ENGINE_COMPATIBILITY };
