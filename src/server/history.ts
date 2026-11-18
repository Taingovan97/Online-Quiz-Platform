import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
export { scoreSummary } from "@/lib/grading/summary";

export type HistoryRow = {
  id: string;
  quiz_id: string;
  status: "in_progress" | "submitted";
  started_at: string;
  submitted_at: string | null;
  submit_reason: "manual" | "timeout" | null;
  score: number | null;
  correct_count: number | null;
  total_questions: number;
  quizzes: { title: string } | null;
  profiles?: { full_name: string; email: string } | null;
};

const COLUMNS =
  "id, quiz_id, status, started_at, submitted_at, submit_reason, score, correct_count, total_questions, quizzes(title)";

/** A user's attempts, newest first (RLS: own rows only for students). */
export async function listAttempts(db: SupabaseClient, userId: string, limit = 200): Promise<HistoryRow[]> {
  const { data } = await db
    .from("attempts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<HistoryRow[]>();
  return data ?? [];
}

/** All users' attempts for the admin view. */
export async function listAllAttempts(db: SupabaseClient, limit = 200): Promise<HistoryRow[]> {
  const { data } = await db
    .from("attempts")
    .select(`${COLUMNS}, profiles(full_name, email)`)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<HistoryRow[]>();
  return data ?? [];
}
