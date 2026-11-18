import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fail, ok, type Result } from "@/lib/result";
import { t } from "@/lib/i18n/vi";
import {
  generateInviteToken,
  hashInviteToken,
  invitationState,
  inviteExpiry,
} from "@/lib/auth/token";

/*
 * Core invitation/user logic. Every function takes a *secret-key* client and
 * assumes the caller has already been authorized (see server actions).
 */

export const emailSchema = z.email().transform((e) => e.trim().toLowerCase());

export const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  fullName: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(72),
});

export async function createInvitation(
  admin: SupabaseClient,
  input: { email: string; createdBy: string; ttlHours: number; origin: string; now?: Date },
): Promise<Result<{ link: string; expiresAt: string }>> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return fail("VALIDATION", t.errors.validation);
  const email = parsed.data;

  const { data: existing, error: existingErr } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingErr) return fail("INTERNAL", t.errors.internal);
  if (existing) return fail("CONFLICT", t.users.alreadyUser);

  const now = input.now ?? new Date();
  // Revoke any open invitation for this email (unique partial index allows one).
  const { error: revokeErr } = await admin
    .from("invitations")
    .update({ revoked_at: now.toISOString() })
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (revokeErr) return fail("INTERNAL", t.errors.internal);

  const token = generateInviteToken();
  const expiresAt = inviteExpiry(now, input.ttlHours).toISOString();
  const { error } = await admin.from("invitations").insert({
    email,
    token_hash: hashInviteToken(token),
    expires_at: expiresAt,
    created_by: input.createdBy,
  });
  if (error) return fail("INTERNAL", t.errors.internal);

  const link = new URL(`/invite/${token}`, input.origin).toString();
  return ok({ link, expiresAt });
}

type InvitationRow = {
  id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

/** Looks up an invitation by its raw token; returns it only when still open. */
export async function findOpenInvitation(
  admin: SupabaseClient,
  token: string,
  now = new Date(),
): Promise<InvitationRow | null> {
  const { data } = await admin
    .from("invitations")
    .select("id, email, expires_at, accepted_at, revoked_at")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle<InvitationRow>();
  if (!data || invitationState(data, now) !== "open") return null;
  return data;
}

export async function acceptInvitation(
  admin: SupabaseClient,
  input: { token: string; fullName: string; password: string; now?: Date },
): Promise<Result<{ email: string; userId: string }>> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", t.errors.validation);
  const { token, fullName, password } = parsed.data;

  const inv = await findOpenInvitation(admin, token, input.now);
  if (!inv) return fail("INVITE_INVALID", t.invite.invalid);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: inv.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created.user) return fail("INVITE_INVALID", t.invite.invalid);
  const userId = created.user.id;

  const rollback = async () => {
    await admin.auth.admin.deleteUser(userId); // cascades to profiles
  };

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: userId, email: inv.email, full_name: fullName, role: "student" });
  if (profileErr) {
    await rollback();
    return fail("INTERNAL", t.errors.internal);
  }

  // Claim the invitation atomically; guards against a concurrent revoke.
  const { data: claimed, error: claimErr } = await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_user_id: userId })
    .eq("id", inv.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");
  if (claimErr || !claimed || claimed.length !== 1) {
    await rollback();
    return fail("INVITE_INVALID", t.invite.invalid);
  }

  return ok({ email: inv.email, userId });
}

export async function revokeInvitation(admin: SupabaseClient, id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return fail("VALIDATION", t.errors.validation);
  const { error } = await admin
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (error) return fail("INTERNAL", t.errors.internal);
  return ok(undefined);
}

/** ~100 years; Supabase Auth has no "permanent" ban value. */
const BAN_FOREVER = "876000h";

export async function setUserActive(
  admin: SupabaseClient,
  input: { actorId: string; userId: string; active: boolean },
): Promise<Result> {
  if (!z.uuid().safeParse(input.userId).success) return fail("VALIDATION", t.errors.validation);
  if (input.actorId === input.userId && !input.active) {
    return fail("FORBIDDEN", t.users.cannotDeactivateSelf);
  }

  const { error: banErr } = await admin.auth.admin.updateUserById(input.userId, {
    ban_duration: input.active ? "none" : BAN_FOREVER,
  });
  if (banErr) return fail("INTERNAL", t.errors.internal);

  const { data, error } = await admin
    .from("profiles")
    .update({ is_active: input.active })
    .eq("id", input.userId)
    .select("id");
  if (error) return fail("INTERNAL", t.errors.internal);
  if (!data || data.length === 0) return fail("NOT_FOUND", t.errors.notFound);
  return ok(undefined);
}
