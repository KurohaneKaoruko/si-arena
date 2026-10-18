import type { ExecuteTickInput, ExecuteTickResult, GameRules, Replay } from "@si-arena/protocol";

/** The execution boundary is injected; the engine never evaluates player JS itself. */
export interface BotExecutor {
  executeTick(input: ExecuteTickInput): Promise<ExecuteTickResult>;
  dispose(): Promise<void>;
}

export interface MatchRunner<State, Observation, Action, Event> {
  rules: GameRules<State, Observation, Action, Event>;
  executor: BotExecutor;
  run(): Promise<Replay<State, Action>>;
}
