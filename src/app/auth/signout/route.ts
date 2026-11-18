import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Ends the session of a deactivated user and sends them to the login page. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const url = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("reason") === "inactive") {
    url.searchParams.set("reason", "inactive");
  }
  return NextResponse.redirect(url);
}
