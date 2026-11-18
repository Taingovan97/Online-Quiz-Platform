import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PASSWORD = "correct-horse-42";

export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** A client signed in as the given user (RLS applies). */
export async function signInAs(email: string, password = PASSWORD): Promise<SupabaseClient> {
  const db = anonDb();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

/** Deletes all app data and auth users. Integration tests run serially. */
export async function resetDb() {
  const admin = adminDb();
  await admin.from("invitations").delete().not("id", "is", null);
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) break;
    for (const u of data.users) await admin.auth.admin.deleteUser(u.id);
  }
}

export async function createUser(
  email: string,
  role: "admin" | "student",
  fullName = role === "admin" ? "Quản trị" : "Học viên",
) {
  const admin = adminDb();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const { error: pErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, email, full_name: fullName, role });
  if (pErr) throw pErr;
  return data.user.id;
}

/** Extracts the raw token from an invitation link. */
export function tokenFromLink(link: string) {
  return new URL(link).pathname.split("/").pop()!;
}
