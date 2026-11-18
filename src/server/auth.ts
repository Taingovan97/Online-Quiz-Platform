import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/result";
import { t } from "@/lib/i18n/vi";

export type Role = "admin" | "student";
export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
};

/**
 * Verifies the session JWT (getClaims) and loads the caller's profile.
 * Returns null when not signed in, the profile is missing, or the user is deactivated.
 * Cached per request.
 */
export const getActiveProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userId)
    .maybeSingle<Profile>();

  if (!profile || !profile.is_active) return null;
  return profile;
});

/** For pages/layouts: redirects to /login (or home) when not allowed. */
export async function requireProfile(role?: Role): Promise<Profile> {
  const profile = await getActiveProfile();
  if (!profile) {
    // Signed in but deactivated/missing profile → end the session.
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) redirect("/auth/signout?reason=inactive");
    redirect("/login");
  }
  if (role && profile.role !== role) redirect("/");
  return profile;
}

/** For server actions: returns a Result failure instead of redirecting. */
export async function authorize(role?: Role) {
  const profile = await getActiveProfile();
  if (!profile) return { profile: null, error: fail("UNAUTHENTICATED", t.errors.unauthenticated) } as const;
  if (role && profile.role !== role) {
    return { profile: null, error: fail("FORBIDDEN", t.errors.forbidden) } as const;
  }
  return { profile, error: null } as const;
}
