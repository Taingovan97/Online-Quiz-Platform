"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { serverEnv } from "@/server/env";
import { createInvitation, revokeInvitation, setUserActive } from "@/server/invitations";
import type { Result } from "@/lib/result";

export async function createInvitationAction(
  email: string,
): Promise<Result<{ link: string; expiresAt: string; ttlHours: number }>> {
  const { profile, error } = await authorize("admin");
  if (error) return error;
  const env = serverEnv();
  const result = await createInvitation(createAdminClient(), {
    email,
    createdBy: profile.id,
    ttlHours: env.INVITE_TTL_HOURS,
    origin: env.APP_ORIGIN,
  });
  if (!result.ok) return result;
  revalidatePath("/admin/users");
  return { ok: true, data: { ...result.data, ttlHours: env.INVITE_TTL_HOURS } };
}

export async function revokeInvitationAction(id: string): Promise<Result> {
  const { error } = await authorize("admin");
  if (error) return error;
  const result = await revokeInvitation(createAdminClient(), id);
  revalidatePath("/admin/users");
  return result;
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<Result> {
  const { profile, error } = await authorize("admin");
  if (error) return error;
  const result = await setUserActive(createAdminClient(), {
    actorId: profile.id,
    userId,
    active,
  });
  revalidatePath("/admin/users");
  return result;
}
