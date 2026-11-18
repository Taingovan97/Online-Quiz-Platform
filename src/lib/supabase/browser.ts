"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser client (publishable key). Used only for signed-URL uploads; RLS applies to anything else. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
