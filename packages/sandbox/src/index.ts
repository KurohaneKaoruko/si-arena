export const SANDBOX_RUNTIME = 'quickjs-wasm' as const
export type { ExecuteTickInput, ExecuteTickResult, ExecutionIdentity } from '@si-arena/protocol'

// No player execution entry is exposed until the isolated runner meets the sandbox contract.
