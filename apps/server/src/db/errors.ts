function pgField(error: unknown, field: string): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[field];
  if (value !== undefined) return value;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) return (cause as Record<string, unknown>)[field];
  return undefined;
}

/** Drizzle wraps driver errors, so the pg code may sit on the error or its cause. */
export function isUniqueViolation(error: unknown): boolean {
  return pgField(error, "code") === "23505";
}

/** Name of the unique constraint that rejected the insert, when available. */
export function uniqueConstraintName(error: unknown): string | null {
  const constraint = pgField(error, "constraint");
  return typeof constraint === "string" ? constraint : null;
}
