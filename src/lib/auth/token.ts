import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url (43 chars). Shown once; only its hash is stored. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteExpiry(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * 3_600_000);
}

export type InvitationState = "open" | "accepted" | "revoked" | "expired";

export function invitationState(
  inv: { expires_at: string; accepted_at: string | null; revoked_at: string | null },
  now: Date,
): InvitationState {
  if (inv.accepted_at) return "accepted";
  if (inv.revoked_at) return "revoked";
  if (now.getTime() >= new Date(inv.expires_at).getTime()) return "expired";
  return "open";
}
