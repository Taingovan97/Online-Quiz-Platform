/** Server-authoritative timing rules (requirements A6). Mirrored in the SQL functions. */

export const GRACE_SECONDS = 10;

/** Saves are accepted up to deadline + grace (network latency allowance). */
export function acceptsSave(now: Date, deadline: Date, graceSeconds = GRACE_SECONDS): boolean {
  return now.getTime() <= deadline.getTime() + graceSeconds * 1000;
}

/** A submission after the deadline is recorded as a timeout at the deadline. */
export function effectiveSubmit(now: Date, deadline: Date, reason: "manual" | "timeout") {
  return now.getTime() > deadline.getTime()
    ? { reason: "timeout" as const, submittedAt: deadline }
    : { reason, submittedAt: now };
}

/** Milliseconds left, using the client clock corrected by the measured server offset. */
export function remainingMs(deadline: Date, clientNowMs: number, serverOffsetMs: number): number {
  return Math.max(0, deadline.getTime() - (clientNowMs + serverOffsetMs));
}
