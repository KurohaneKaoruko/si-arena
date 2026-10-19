import type { JsonValue } from "@si-arena/protocol";
import { SandboxPlayer } from "./player";
import { SandboxSystemError, type SandboxOptions } from "./types";

/** Starts on the first active tick, using its fallback; close also drains pending startup. */
export function createSandboxExecutor<Action extends JsonValue>(
  options: Omit<SandboxOptions<Action>, "defaultAction">,
) {
  let pending: Promise<SandboxPlayer<Action>> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closed = true;
    closing ??= (async () => {
      await (await pending)?.close();
    })();
    return closing;
  }
  return {
    async execute(tick: number, observation: unknown, defaultAction: Action) {
      if (closed) throw new SandboxSystemError("Player executor is closed");
      pending ??= SandboxPlayer.create({ ...options, defaultAction });
      const executor = await pending;
      if (closed) {
        await close();
        throw new SandboxSystemError("Player executor is closed");
      }
      return executor.execute(tick, observation, defaultAction);
    },
    close,
  };
}
