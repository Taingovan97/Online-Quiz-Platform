"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/admin-client";
import { acceptInvitation } from "@/server/invitations";
import { t } from "@/lib/i18n/vi";

export type AcceptState = { error?: string };

export async function acceptInvite(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirmPassword") ?? "")) {
    return { error: t.invite.passwordMismatch };
  }

  const result = await acceptInvitation(createAdminClient(), {
    token: String(formData.get("token") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    password,
  });
  if (!result.ok) return { error: result.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: result.data.email,
    password,
  });
  if (error) redirect("/login");
  redirect("/");
}
