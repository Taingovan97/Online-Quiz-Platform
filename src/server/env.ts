import "server-only";
import { z } from "zod";

const schema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  APP_ORIGIN: z.url(),
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(72),
});

let cached: z.infer<typeof schema> | undefined;

/** Server-only secrets, validated lazily so `next build` works without them. */
export function serverEnv() {
  cached ??= schema.parse(process.env);
  return cached;
}
