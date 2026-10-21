import type { JsonObject, JsonValue } from "@si-arena/protocol";
import type { ArenaSettings, GameResult, ResourceLimits } from "@si-arena/protocol";
import type { GameDefinition, MatchSummary, ReplayPlayer } from "@si-arena/engine";
import { runMatch } from "@si-arena/engine";
import { ReplayFileSink } from "@si-arena/engine/node";
import { createSandboxExecutor, MatchLogBudget, type ProcessIsolation } from "@si-arena/sandbox";
import { cloneJson } from "@si-arena/protocol";

const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

export interface SandboxMatchRequest {
  matchId: string;
  seed: number;
  config: JsonObject;
  limits: ResourceLimits;
  players: ReplayPlayer[];
  /** Player source code indexed by seat slot. */
  sources: string[];
  /** Immutable candidate path; publishing to the public name happens at settlement. */
  replayPath: string;
  isolation: ProcessIsolation;
  signal?: AbortSignal;
}

export interface SandboxMatchOutcome {
  result: GameResult;
  finalStateHash: string;
}

export interface SandboxGameRegistration {
  gameId: string;
  release: string;
  arena?: ArenaSettings;
  run(request: SandboxMatchRequest): Promise<SandboxMatchOutcome>;
}

/**
 * Closes over the game's type parameters so the worker itself never branches on
 * game identities. Frozen per-match config and limits override the manifest.
 */
export function defineSandboxGame<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(options: {
  game: GameDefinition<State, Observation, Action, Event>;
  sdkSource: string;
}): SandboxGameRegistration {
  const { game } = options;
  return {
    gameId: game.manifest.id,
    release: game.manifest.release,
    ...(game.manifest.arena ? { arena: game.manifest.arena } : {}),
    async run(request) {
      const logBudget = new MatchLogBudget(request.limits.logs.matchBytes);
      const sink = new ReplayFileSink<State, Action>(request.replayPath, MAX_REPLAY_BYTES);
      let summary: MatchSummary<State>;
      try {
        summary = await runMatch({
          matchId: request.matchId,
          game,
          players: request.players,
          seed: request.seed,
          config: request.config,
          captureLogs: false,
          sink,
          ...(request.signal ? { signal: request.signal } : {}),
          async createExecutor(player, context) {
            return createSandboxExecutor({
              ...context,
              playerId: player.id,
              source: request.sources[player.slot]!,
              sdkSource: options.sdkSource,
              limits: cloneJson(request.limits),
              isolation: request.isolation,
              parseAction: game.rules.parseAction,
              logBudget,
            });
          },
        });
      } catch (error) {
        await sink.abort().catch(() => undefined);
        throw error;
      }
      return { result: summary.result, finalStateHash: summary.finalStateHash };
    },
  };
}
