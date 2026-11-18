/** Seeds published quizzes for browser tests using only pure modules + the secret-key client. */
import { applyQuestionEdit } from "../src/lib/quiz/edit";
import { buildSnapshot } from "../src/lib/quiz/snapshot";
import type { QuestionDraft } from "../src/lib/quiz/types";
import { adminDb } from "../tests/integration/helpers";

export type SeedQuestion = { content: string; options: string[]; correct: string[]; explanation?: string };

export async function seedPublishedQuiz(opts: {
  adminId: string;
  title: string;
  subject: string;
  durationMinutes: number;
  questions: SeedQuestion[];
}) {
  const db = adminDb();
  let { data: subject } = await db.from("subjects").select("id").eq("name", opts.subject).maybeSingle();
  if (!subject) ({ data: subject } = await db.from("subjects").insert({ name: opts.subject }).select("id").single());
  const { data: quiz, error } = await db
    .from("quizzes")
    .insert({
      title: opts.title,
      subject_id: subject!.id,
      created_by: opts.adminId,
      duration_minutes: opts.durationMinutes,
      default_mode: "mixed",
    })
    .select("id")
    .single();
  if (error) throw error;

  const drafts: QuestionDraft[] = [];
  for (const [i, q] of opts.questions.entries()) {
    const selectionType = q.correct.length > 1 ? "multiple" : "single";
    const write = applyQuestionEdit(null, {
      content: q.content,
      selectionType,
      explanation: q.explanation ?? null,
      options: q.options.map((text, j) => ({ content: text, isCorrect: q.correct.includes("ABCDEF"[j]) })),
    });
    const { data: id, error: qErr } = await db.rpc("save_question", {
      p_quiz: quiz!.id,
      p_question: null,
      p_fields: write.fields,
      p_options: write.options,
    });
    if (qErr) throw qErr;
    drafts.push({
      id: id as string,
      position: i + 1,
      content: write.fields.content,
      selectionType,
      explanation: write.fields.explanation,
      answerStatus: "verified",
      answerSource: "manually_verified",
      originalAnswer: null,
      options: write.options.map((o) => ({ label: o.label, content: o.content, isCorrect: o.is_correct })),
    });
  }

  const snapshot = buildSnapshot(
    { id: quiz!.id, title: opts.title, durationMinutes: opts.durationMinutes, defaultMode: "mixed" },
    opts.subject,
    drafts,
  );
  const { error: pErr } = await db.rpc("publish_quiz", {
    p_quiz: quiz!.id,
    p_user: opts.adminId,
    p_snapshot: snapshot,
    p_question_count: drafts.length,
  });
  if (pErr) throw pErr;
  return { quizId: quiz!.id as string, questionIds: drafts.map((d) => d.id) };
}
