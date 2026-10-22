import type {
  GameCatalogEntry,
  GameResult,
  JsonObject,
  JsonValue,
  ResourceLimits,
} from "@si-arena/protocol";
import type { GameDefinition, ReplayPlayer } from "@si-arena/engine";
import { runMatchProcess, type ProcessIsolation, type GameModule } from "@si-arena/runner";

export interface SandboxMatchRequest {
  matchId: string;
  seed: number;
  config: JsonObject;
  limits: ResourceLimits;
  players: ReplayPlayer[];
  sources: string[];
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
  arena?: GameCatalogEntry["arena"];
  run(request: SandboxMatchRequest): Promise<SandboxMatchOutcome>;
}
export function defineSandboxGame<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(options: {
  game: GameDefinition<State, Observation, Action, Event>;
  module: GameModule;
}): SandboxGameRegistration {
  const { game, module } = options;
  return {
    gameId: game.manifest.id,
    release: game.manifest.release,
    ...(game.manifest.arena ? { arena: game.manifest.arena } : {}),
    async run(request) {
      return runMatchProcess({
        module,
        manifest: { ...game.manifest, resolvedLimits: request.limits },
        matchId: request.matchId,
        seed: request.seed,
        config: request.config,
        players: request.players,
        sources: request.sources,
        replayPath: request.replayPath,
        isolation: request.isolation,
        ...(request.signal ? { signal: request.signal } : {}),
      });
    },
  };
}
