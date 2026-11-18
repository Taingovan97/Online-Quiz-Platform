import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/server";
import { loadQuestions } from "@/server/quizzes";
import { aiConfig } from "@/server/ai-providers";
import { t } from "@/lib/i18n/vi";
import type { AnswerMode, QuizStatus } from "@/lib/quiz/types";
import type { ImportSummary, ParseWarning } from "@/lib/pdf-import/types";
import { QuestionReview } from "./question-review";

export default async function QuizQuestionsPage({ params }: PageProps<"/admin/quizzes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: quiz }, { data: job }, { data: numbers }] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, status, default_mode")
      .eq("id", id)
      .maybeSingle<{ id: string; status: QuizStatus; default_mode: AnswerMode }>(),
    supabase
      .from("import_jobs")
      .select("file_name, summary, warnings")
      .eq("quiz_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ file_name: string; summary: ImportSummary | null; warnings: ParseWarning[] }>(),
    supabase.from("questions").select("id, source_number").eq("quiz_id", id),
  ]);
  if (!quiz) notFound();

  // Admin RLS policies allow reading questions with the user's own session.
  const questions = await loadQuestions(supabase, id);

  // Attach per-question import warnings via the number printed in the PDF.
  const idByNumber = new Map((numbers ?? []).map((n) => [n.source_number as number, n.id as string]));
  const warnings: Record<string, string[]> = {};
  const jobWarnings: ParseWarning[] = [];
  for (const w of job?.warnings ?? []) {
    const qid = w.questionNumber !== undefined ? idByNumber.get(w.questionNumber) : undefined;
    if (qid && w.code !== "ORPHAN_KEY_ENTRY") (warnings[qid] ??= []).push(w.detail);
    else jobWarnings.push(w);
  }

  const ai = aiConfig();
  const banner =
    job && (jobWarnings.length > 0 || job.summary?.keyFound === false) ? (
      <Alert>
        <AlertTitle>
          {t.imports.warningsTitle} · {job.file_name}
        </AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-4">
            {job.summary?.keyFound === false && <li>{t.imports.keyMissing}</li>}
            {jobWarnings
              .filter((w) => w.code !== "NO_ANSWER_KEY")
              .map((w, i) => (
                <li key={i}>{w.detail}</li>
              ))}
          </ul>
        </AlertDescription>
      </Alert>
    ) : null;

  return (
    <QuestionReview
      quiz={{ id: quiz.id, status: quiz.status, mode: quiz.default_mode }}
      questions={questions}
      warnings={warnings}
      banner={banner}
      ai={ai.enabled ? { model: ai.model } : undefined}
    />
  );
}
