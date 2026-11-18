import { connection, NextResponse } from "next/server";
import { createAdminClient } from "@/server/admin-client";

/** Keep-alive target for the scheduled GitHub Action: touches the database once. */
export async function GET() {
  await connection();
  const { error } = await createAdminClient()
    .from("profiles")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  return NextResponse.json({ ok: !error }, { status: error ? 503 : 200 });
}
