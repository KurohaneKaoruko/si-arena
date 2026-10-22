import { validateSource } from "@si-arena/runner";
import type { ResourceLimits } from "@si-arena/protocol";
import { createConcurrencyLimiter } from "../concurrency";

export type CodeValidationOutcome = { ok: true } | { ok: false; reason: "BUSY" | "INVALID" };

const validationGate = createConcurrencyLimiter(2);

/**
 * Runs the sandbox's static player-source check (Acorn AST restrictions plus a
 * compile-only pass in the same V8 sandbox used for execution). At most two
 * validations run per process; excess requests fail fast.
 */
export async function validatePlayerSource(
  source: string,
  limits: ResourceLimits,
): Promise<CodeValidationOutcome> {
  if (!validationGate.acquire()) return { ok: false, reason: "BUSY" };
  try {
    const result = await validateSource({ source, limits, isolation: { kind: "local" } });
    if (result.ok) return { ok: true };
    return { ok: false, reason: "INVALID" };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: "INVALID" };
    throw error;
  } finally {
    validationGate.release();
  }
}
