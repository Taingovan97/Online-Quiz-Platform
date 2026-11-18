/**
 * Creates the first admin account. Run locally with the target project's env:
 *   npm run bootstrap-admin -- --email you@example.com --name "Admin" [--env .env.local] [--force]
 * The password is read from the ADMIN_PASSWORD env var or prompted interactively.
 */
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    env: { type: "string", default: ".env.local" },
    force: { type: "boolean", default: false },
  },
});

config({ path: values.env, quiet: true });

async function main() {
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !name) throw new Error('Usage: --email <email> --name "<full name>"');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error(`NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing in ${values.env}`);

  const admin = createClient(url, secret, { auth: { persistSession: false } });

  const { count, error: countErr } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (countErr) throw countErr;
  if ((count ?? 0) > 0 && !values.force) {
    throw new Error("An admin already exists. Re-run with --force to add another.");
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Admin password (min 8 chars): ");
    rl.close();
  }
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, email, full_name: name, role: "admin" });
  if (profileErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw profileErr;
  }
  console.log(`Admin created: ${email}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
