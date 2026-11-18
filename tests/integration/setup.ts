import { execSync } from "node:child_process";

/**
 * Reads connection details from the running local Supabase stack (`npx supabase start`)
 * and exposes them as the env vars the app code expects.
 */
function loadLocalSupabaseEnv() {
  let out: string;
  try {
    out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("Local Supabase is not running. Start Docker Desktop, then run `npm run db:start`.");
  }
  const vars: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) vars[m[1]] = m[2];
  }
  const url = vars.API_URL;
  const publishable = vars.PUBLISHABLE_KEY ?? vars.ANON_KEY;
  const secret = vars.SECRET_KEY ?? vars.SERVICE_ROLE_KEY;
  if (!url || !publishable || !secret) {
    throw new Error(`Unexpected \`supabase status\` output; got keys: ${Object.keys(vars).join(", ")}`);
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishable;
  process.env.SUPABASE_SECRET_KEY = secret;
  process.env.APP_ORIGIN ??= "http://localhost:3000";
}

loadLocalSupabaseEnv();
