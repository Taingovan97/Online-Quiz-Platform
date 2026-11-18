import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fail, ok, type Result } from "@/lib/result";
import { t } from "@/lib/i18n/vi";
import { applyQuestionEdit } from "@/lib/quiz/edit";
import { buildSnapshot } from "@/lib/quiz/snapshot";
import { validateQuiz } from "@/lib/quiz/validate";
import type {
  AnswerMode,
  QuestionDraft,
  QuizStatus,
  SelectionType,
  ValidationIssue,
} from "@/lib/quiz/types";

/*
 * Quiz management core. Every function takes a *secret-key* client and assumes
 * the caller is an authorized admin (see server actions).
 */

const uuid = z.uuid();
const mode = z.enum(["single", "multiple", "mixed"]);

function mapDbError(error: { message: string } | null): Result<never> | null {
  if (!error) return null;
  if (error.message.includes("QUIZ_NOT_DRAFT")) return fail("CONFLICT", t.quiz.notDraft);
  if (error.message.includes("NOT_FOUND")) return fail("NOT_FOUND", t.errors.notFound);
  if (error.message.includes("subjects_name_ci")) return fail("CONFLICT", t.subjects.duplicate);
  if (error.message.includes("foreign key")) return fail("CONFLICT", t.subjects.inUse);
  return fail("INTERNAL", t.errors.internal);
}

// Subjects ----------------------------------------------------------

export const subjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
});

export async function saveSubject(
  db: SupabaseClient,
  id: string | null,
  input: z.input<typeof subjectSchema>,
): Promise<Result<{ id: string }>> {
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", t.errors.validation);
  const query = id
    ? db.from("subjects").update(parsed.data).eq("id", id).select("id").single()
    : db.from("subjects").insert(parsed.data).select("id").single();
  const { data, error } = await query;
  return mapDbError(error) ?? ok({ id: data!.id as string });
}

export async function deleteSubject(db: SupabaseClient, id: string): Promise<Result> {
  if (!uuid.safeParse(id).success) return fail("VALIDATION", t.errors.validation);
  const { error } = await db.from("subjects").delete().eq("id", id);
  return mapDbError(error) ?? ok(undefined);
}

// Quizzes -----------------------------------------------------------

export const quizSettingsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().transform((v) => v || null),
  subjectId: uuid,
  durationMinutes: z.coerce.number().int().min(1).max(300),
  defaultMode: mode,
});

export async function createQuiz(
  db: SupabaseClient,
  input: { title: string; subjectId: string; createdBy: string },
): Promise<Result<{ id: string }>> {
  const parsed = z
    .object({ title: z.string().trim().min(1).max(200), subjectId: uuid, createdBy: uuid })
    .safeParse(input);
  if (!parsed.success) return fail("VALIDATION", t.errors.validation);
  const { data, error } = await db
    .from("quizzes")
    .insert({
      title: parsed.data.title,
      subject_id: parsed.data.subjectId,
      created_by: parsed.data.createdBy,
    })
    .select("id")
    .single();
  return mapDbError(error) ?? ok({ id: data!.id as string });
}

async function quizStatus(db: SupabaseClient, quizId: string): Promise<QuizStatus | null> {
  const { data } = await db.from("quizzes").select("status").eq("id", quizId).maybeSingle();
  return (data?.status as QuizStatus | undefined) ?? null;
}

export async function updateQuizSettings(
  db: SupabaseClient,
  quizId: string,
  input: z.input<typeof quizSettingsSchema>,
  applyModeToQuestions = false,
): Promise<Result> {
  const parsed = quizSettingsSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(quizId).success) return fail("VALIDATION", t.errors.validation);
  const status = await quizStatus(db, quizId);
  if (!status) return fail("NOT_FOUND", t.errors.notFound);
  if (status !== "draft") return fail("CONFLICT", t.quiz.notDraft);

  const s = parsed.data;
  const { error } = await db
    .from("quizzes")
    .update({
      title: s.title,
      description: s.description,
      subject_id: s.subjectId,
      duration_minutes: s.durationMinutes,
      default_mode: s.defaultMode,
    })
    .eq("id", quizId)
    .eq("status", "draft");
  if (error) return mapDbError(error)!;

  if (applyModeToQuestions && s.defaultMode !== "mixed") {
    const { error: qErr } = await db
      .from("questions")
      .update({ selection_type: s.defaultMode })
      .eq("quiz_id", quizId);
    if (qErr) return mapDbError(qErr)!;
  }
  return ok(undefined);
}

export async function deleteQuiz(db: SupabaseClient, quizId: string): Promise<Result> {
  if (!uuid.safeParse(quizId).success) return fail("VALIDATION", t.errors.validation);
  const status = await quizStatus(db, quizId);
  if (!status) return fail("NOT_FOUND", t.errors.notFound);
  const { count } = await db
    .from("quiz_versions")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId);
  if (status !== "draft" || (count ?? 0) > 0) return fail("CONFLICT", t.quiz.cannotDelete);
  const { error } = await db.from("quizzes").delete().eq("id", quizId).eq("status", "draft");
  return mapDbError(error) ?? ok(undefined);
}

export async function setQuizStatus(
  db: SupabaseClient,
  quizId: string,
  action: "unpublish" | "archive" | "unarchive",
): Promise<Result> {
  if (!uuid.safeParse(quizId).success) return fail("VALIDATION", t.errors.validation);
  const transitions = {
    unpublish: { from: "published", to: "draft" },
    archive: { from: "published", to: "archived" },
    unarchive: { from: "archived", to: "published" },
  } as const;
  const { from, to } = transitions[action];
  const { data, error } = await db
    .from("quizzes")
    .update({ status: to })
    .eq("id", quizId)
    .eq("status", from)
    .select("id");
  if (error) return mapDbError(error)!;
  if (!data?.length) return fail("CONFLICT", t.quiz.badTransition);
  return ok(undefined);
}

// Questions ---------------------------------------------------------

type QuestionRow = {
  id: string;
  position: number;
  content: string;
  selection_type: SelectionType;
  explanation: string | null;
  answer_status: QuestionDraft["answerStatus"];
  answer_source: QuestionDraft["answerSource"];
  original_answer: string[] | null;
  question_options: { label: string; content: string; is_correct: boolean }[];
};

export async function loadQuestions(db: SupabaseClient, quizId: string): Promise<QuestionDraft[]> {
  const { data, error } = await db
    .from("questions")
    .select(
      "id, position, content, selection_type, explanation, answer_status, answer_source, original_answer, question_options(label, content, is_correct)",
    )
    .eq("quiz_id", quizId)
    .order("position")
    .returns<QuestionRow[]>();
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    position: r.position,
    content: r.content,
    selectionType: r.selection_type,
    explanation: r.explanation,
    answerStatus: r.answer_status,
    answerSource: r.answer_source,
    originalAnswer: r.original_answer,
    options: [...r.question_options]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((o) => ({ label: o.label, content: o.content, isCorrect: o.is_correct })),
  }));
}

export const questionInputSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  selectionType: z.enum(["single", "multiple"]),
  explanation: z.string().max(5000).nullable(),
  options: z
    .array(z.object({ content: z.string().trim().min(1).max(2000), isCorrect: z.boolean() }))
    .min(2)
    .max(6),
});

export async function saveQuestion(
  db: SupabaseClient,
  quizId: string,
  questionId: string | null,
  input: z.input<typeof questionInputSchema>,
): Promise<Result<{ id: string }>> {
  const parsed = questionInputSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(quizId).success) return fail("VALIDATION", t.errors.validation);
  if (questionId && !uuid.safeParse(questionId).success) return fail("VALIDATION", t.errors.validation);

  let existing: QuestionDraft | null = null;
  if (questionId) {
    existing = (await loadQuestions(db, quizId)).find((q) => q.id === questionId) ?? null;
    if (!existing) return fail("NOT_FOUND", t.errors.notFound);
  }
  const write = applyQuestionEdit(existing, parsed.data);
  const { data, error } = await db.rpc("save_question", {
    p_quiz: quizId,
    p_question: questionId,
    p_fields: write.fields,
    p_options: write.options,
  });
  return mapDbError(error) ?? ok({ id: data as string });
}

export async function deleteQuestion(db: SupabaseClient, quizId: string, questionId: string): Promise<Result> {
  if (!uuid.safeParse(quizId).success || !uuid.safeParse(questionId).success) {
    return fail("VALIDATION", t.errors.validation);
  }
  const { error } = await db.rpc("delete_question", { p_quiz: quizId, p_question: questionId });
  return mapDbError(error) ?? ok(undefined);
}

/** Confirms the current answers of the given questions. Questions without a correct option are skipped. */
export async function verifyQuestions(
  db: SupabaseClient,
  quizId: string,
  ids: string[],
): Promise<Result<{ verified: number; skipped: number }>> {
  if (!uuid.safeParse(quizId).success || !z.array(uuid).max(500).safeParse(ids).success) {
    return fail("VALIDATION", t.errors.validation);
  }
  const status = await quizStatus(db, quizId);
  if (status !== "draft") return fail("CONFLICT", t.quiz.notDraft);

  const questions = (await loadQuestions(db, quizId)).filter((q) => ids.includes(q.id));
  const eligible = questions.filter((q) => q.options.some((o) => o.isCorrect)).map((q) => q.id);
  if (eligible.length) {
    // Source is kept (PDF / AI); a confirmed answer with no source was entered by hand.
    const { error } = await db
      .from("questions")
      .update({ answer_status: "verified" })
      .eq("quiz_id", quizId)
      .in("id", eligible);
    if (error) return mapDbError(error)!;
    await db
      .from("questions")
      .update({ answer_source: "manually_verified" })
      .eq("quiz_id", quizId)
      .in("id", eligible)
      .is("answer_source", null);
  }
  return ok({ verified: eligible.length, skipped: ids.length - eligible.length });
}

// Publishing --------------------------------------------------------

export async function publishQuiz(
  db: SupabaseClient,
  quizId: string,
  userId: string,
): Promise<Result<{ published: true; versionNo: number } | { published: false; issues: ValidationIssue[] }>> {
  if (!uuid.safeParse(quizId).success) return fail("VALIDATION", t.errors.validation);
  const { data: quiz } = await db
    .from("quizzes")
    .select("id, title, duration_minutes, default_mode, status, subjects(name)")
    .eq("id", quizId)
    .maybeSingle<{
      id: string;
      title: string;
      duration_minutes: number;
      default_mode: AnswerMode;
      status: QuizStatus;
      subjects: { name: string } | null;
    }>();
  if (!quiz) return fail("NOT_FOUND", t.errors.notFound);
  if (quiz.status !== "draft") return fail("CONFLICT", t.quiz.notDraft);

  const questions = await loadQuestions(db, quizId);
  const issues = validateQuiz(quiz.default_mode, questions);
  if (issues.length) return ok({ published: false, issues });

  const snapshot = buildSnapshot(
    {
      id: quiz.id,
      title: quiz.title,
      durationMinutes: quiz.duration_minutes,
      defaultMode: quiz.default_mode,
    },
    quiz.subjects?.name ?? "",
    questions,
  );
  const { data, error } = await db.rpc("publish_quiz", {
    p_quiz: quizId,
    p_user: userId,
    p_snapshot: snapshot,
    p_question_count: questions.length,
  });
  return mapDbError(error) ?? ok({ published: true, versionNo: data as number });
}
