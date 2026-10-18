import type { ExecutionError, PlayerLog } from './execution.js'
import type { GameResult } from './game.js'
import type { JsonObject } from './json.js'
import type { ResourceLimits } from './resources.js'

export interface Replay<State, Action> {
  formatVersion: 1
  matchId: string
  game: { id: string; release: string; botProtocolVersion: number; engineCompatibility: string }
  players: Array<{ id: string; slot: number; name: string; official: boolean }>
  config: JsonObject
  resolvedLimits: ResourceLimits
  initialState: State
  ticks: Array<{
    tick: number
    actions: Record<string, Action>
    errors?: Record<string, ExecutionError>
    logs?: Record<string, PlayerLog[]>
    logsTruncated?: Record<string, true>
    resources?: Record<string, { cpuUsedUs?: number; memoryBytes?: number }>
  }>
  result: GameResult
  finalStateHash: string
}
