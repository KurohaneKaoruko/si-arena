import { PAPER_SDK_SOURCE, paperGame } from "@si-arena/game-paper/game";
import { defineSandboxGame, type SandboxGameRegistration } from "./sandbox-match";

// New games join by registering their trusted definition here; the rest of the
// worker stays game-agnostic.
const registrations: readonly SandboxGameRegistration[] = [
  defineSandboxGame({ game: paperGame, sdkSource: PAPER_SDK_SOURCE }),
];

/** The worker only claims matches whose frozen release it has installed. */
export function claimableReleases(): ReadonlyArray<{ gameId: string; release: string }> {
  return registrations.map((game) => ({ gameId: game.gameId, release: game.release }));
}

export function findWorkerGame(gameId: string, release: string): SandboxGameRegistration | null {
  return registrations.find((game) => game.gameId === gameId && game.release === release) ?? null;
}
