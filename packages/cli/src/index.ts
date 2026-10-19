export { CLI_NAME, CLI_VERSION } from "./metadata";
export { runCli, type CliContext } from "./commands";
export {
  defineLocalGame,
  type LocalGameRegistration,
  type PreparedLocalMatch,
  type LocalSummary,
  type LocalDiagnostic,
} from "./local-game";
