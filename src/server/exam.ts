import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fail, ok, type Result } from "@/lib/result";
import { t } from "@/lib/i18n/vi";
import { GRACE_SECONDS } from "@/lib/grading/deadline";
import { gradeAttempt as gradePure } from "@/lib/grading/grade";
import { redactSnapshot } from "@/lib/quiz/snapshot";
import type { QuizSnapshot, RedactedSnapshot } from "@/lib/quiz/types";

/*
 * Exam core. Every function takes the *secret-key* client plus the verified
 * caller id, and scopes every query to that user (admins may read results).
 */

export type AttemptRow = {
  id: string;
  user_id: string;
  quiz_id: string;
  quiz_version_id: string;
  status: "in_progress" | "submitted";
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  submit_reason: "manual" | "timeout" | null;
  graded_at: string | null;
  total_questions: number;
  correct_count: number | null;
  incorrect_count: number | null;
  unanswered_count: number | null;
  score: number | null;
};

const uuid = z.uuid();

function dbError(error: { message: string }): Result<never> {
  for (const code of ["ATTEMPT_CLOSED", "DEADLINE_PASSED", "QUIZ_NOT_AVAILABLE", "NOT_FOUND"] as const) {
    if (error.message.includes(code)) {
      if (code === "NOT_FOUND") return fail("NOT_FOUND", t.errors.notFound);
      if (code === "QUIZ_NOT_AVAILABLE") return fail("CONFLICT", t.examErrors.notAvailable);
      return fail(code, t.examErrors[code]);
    }
  }
  return fail("INTERNAL", t.errors.internal);
}

async function loadSnapshot(db: SupabaseClient, versionId: string): Promise<QuizSnapshot> {
  const { data, error } = await db.from("quiz_versions").select("snapshot").eq("id", versionId).single();
  if (error || !data) throw new Error("snapshot missing");
  return data.snapshot as QuizSnapshot;
}

async function loadAnswers(db: SupabaseClient, attemptId: string) {
  const { data } = await db
    .from("attempt_answers")
    .select("question_id, selected_labels, is_correct")
    .eq("attempt_id", attemptId);
  return data ?? [];
}

/** Lazily finalizes the user's expired attempts and grades them. */
export async function closeExpiredAttempts(db: SupabaseClient, userId: string | null) {
  const { data } = await db.rpc("close_expired_attempts", { p_user: userId, p_grace_s: GRACE_SECONDS });
  for (const id of (data as string[] | null) ?? []) await gradeAttempt(db, id);
}

export async function startAttempt(db: SupabaseClient, userId: string, quizId: string): Promise<Result<{ attemptId: string }>> {
  if (!uuid.safeParse(quizId).success) return fail("VALIDATION", t.errors.validation);
  await closeExpiredAttempts(db, userId);
  const { data, error } = await db.rpc("start_attempt", { p_user: userId, p_quiz: quizId });
  if (error) return dbError(error);
  return ok({ attemptId: (data as AttemptRow).id });
}

async function ownAttempt(db: SupabaseClient, userId: string, attemptId: string) {
  if (!uuid.safeParse(attemptId).success) return null;
  const { data } = await db.from("attempts").select("*").eq("id", attemptId).eq("user_id", userId).maybeSingle<AttemptRow>();
  return data;
}

export type ExamPaper = {
  attempt: Pick<AttemptRow, "id" | "status" | "started_at" | "deadline_at">;
  paper: RedactedSnapshot;
  answers: Record<string, string[]>;
  serverNow: string;
};

/** The question paper for an in-progress attempt — never includes the key or explanations. */
export async function getExamPaper(
  db: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<Result<ExamPaper | { submitted: true }>> {
  await closeExpiredAttempts(db, userId);
  const attempt = await ownAttempt(db, userId, attemptId);
  if (!attempt) return fail("NOT_FOUND", t.errors.notFound);
  if (attempt.status === "submitted") return ok({ submitted: true });

  const snapshot = await loadSnapshot(db, attempt.quiz_version_id);
  const answers: Record<string, string[]> = {};
  for (const a of await loadAnswers(db, attemptId)) answers[a.question_id] = a.selected_labels;
  return ok({
    attempt: { id: attempt.id, status: attempt.status, started_at: attempt.started_at, deadline_at: attempt.deadline_at },
    paper: redactSnapshot(snapshot),
    answers,
    serverNow: new Date().toISOString(),
  });
}

export async function saveAnswer(
  db: SupabaseClient,
  userId: string,
  input: { attemptId: string; questionId: string; labels: string[] },
): Promise<Result<{ savedAt: string }>> {
  const parsed = z
    .object({ attemptId: uuid, questionId: uuid, labels: z.array(z.string().regex(/^[A-F]$/)).max(6) })
    .safeParse(input);
  if (!parsed.success) return fail("VALIDATION", t.errors.validation);

  const attempt = await ownAttempt(db, userId, input.attemptId);
  if (!attempt) return fail("NOT_FOUND", t.errors.notFound);
  if (attempt.status !== "in_progress") return fail("ATTEMPT_CLOSED", t.examErrors.ATTEMPT_CLOSED);

  // The question must belong to this attempt's snapshot, and labels to its options.
  const snapshot = await loadSnapshot(db, attempt.quiz_version_id);
  const question = snapshot.questions.find((q) => q.id === input.questionId);
  if (!question) return fail("VALIDATION", t.errors.validation);
  const labels = [...new Set(parsed.data.labels)].sort();
  const valid = new Set(question.options.map((o) => o.label));
  if (!labels.every((l) => valid.has(l))) return fail("VALIDATION", t.errors.validation);
  if (question.selectionType === "single" && labels.length > 1) return fail("VALIDATION", t.errors.validation);

  const { data, error } = await db.rpc("save_answer", {
    p_user: userId,
    p_attempt: input.attemptId,
    p_question: input.questionId,
    p_labels: labels,
    p_grace_s: GRACE_SECONDS,
  });
  if (error) return dbError(error);
  return ok({ savedAt: data as string });
}

/** Grades a submitted attempt once. Safe to call repeatedly. */
export async function gradeAttempt(db: SupabaseClient, attemptId: string): Promise<void> {
  const { data: attempt } = await db.from("attempts").select("*").eq("id", attemptId).maybeSingle<AttemptRow>();
  if (!attempt || attempt.status !== "submitted" || attempt.graded_at) return;
  const snapshot = await loadSnapshot(db, attempt.quiz_version_id);
  const answers = new Map((await loadAnswers(db, attemptId)).map((a) => [a.question_id as string, a.selected_labels as string[]]));
  const g = gradePure(snapshot, answers);
  const results: Record<string, boolean> = {};
  for (const [qid, r] of g.perQuestion) if (r !== "unanswered") results[qid] = r === "correct";
  await db.rpc("record_grade", {
    p_attempt: attemptId,
    p_results: results,
    p_correct: g.correct,
    p_incorrect: g.incorrect,
    p_unanswered: g.unanswered,
    p_score: g.score,
  });
}
export async function submitAttempt(
  db: SupabaseClient,
  userId: string,
  attemptId: string,
  reason: "manual" | "timeout" = "manual",
): Promise<Result<{ attemptId: string }>> {
  if (!uuid.safeParse(attemptId).success) return fail("VALIDATION", t.errors.validation);
  const { error } = await db.rpc("claim_submission", { p_user: userId, p_attempt: attemptId, p_reason: reason });
  if (error) return dbError(error);
  await gradeAttempt(db, attemptId);
  return ok({ attemptId });
}

export type AttemptResult = {
  attempt: AttemptRow;
  snapshot: QuizSnapshot;
  answers: Record<string, string[]>;
};

/** Full review data for a submitted attempt (owner, or any admin). */
export async function getAttemptResult(
  db: SupabaseClient,
  viewer: { id: string; role: "admin" | "student" },
  attemptId: string,
): Promise<Result<AttemptResult>> {
  if (!uuid.safeParse(attemptId).success) return fail("NOT_FOUND", t.errors.notFound);
  await closeExpiredAttempts(db, viewer.role === "admin" ? null : viewer.id);
  let query = db.from("attempts").select("*").eq("id", attemptId);
  if (viewer.role !== "admin") query = query.eq("user_id", viewer.id);
  let { data: attempt } = await query.maybeSingle<AttemptRow>();
  if (!attempt) return fail("NOT_FOUND", t.errors.notFound);
  if (attempt.status !== "submitted") return fail("CONFLICT", t.examErrors.notSubmitted);
  if (!attempt.graded_at) {
    await gradeAttempt(db, attemptId);
    ({ data: attempt } = await db.from("attempts").select("*").eq("id", attemptId).single<AttemptRow>());
  }
  const answers: Record<string, string[]> = {};
  for (const a of await loadAnswers(db, attemptId)) answers[a.question_id] = a.selected_labels;
  return ok({ attempt: attempt!, snapshot: await loadSnapshot(db, attempt!.quiz_version_id), answers });
}
