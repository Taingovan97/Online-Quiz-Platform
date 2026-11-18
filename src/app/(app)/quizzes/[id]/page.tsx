import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { closeExpiredAttempts } from "@/server/exam";
import { formatScore } from "@/lib/grading/grade";
import { t } from "@/lib/i18n/vi";
import type { AnswerMode } from "@/lib/quiz/types";
import { StartButton } from "./start-button";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export default async function QuizDetailPage({ params }: PageProps<"/quizzes/[id]">) {
  const { id } = await params;
  const profile = await requireProfile();
  await closeExpiredAttempts(createAdminClient(), profile.id);

  const supabase = await createClient();
  const [{ data: quiz }, { data: attempts }] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, title, description, duration_minutes, default_mode, status, subjects(name), quiz_versions!quizzes_current_version_fk(question_count)")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        title: string;
        description: string | null;
        duration_minutes: number;
        default_mode: AnswerMode;
        status: string;
        subjects: { name: string } | null;
        quiz_versions: { question_count: number } | null;
      }>(),
    supabase
      .from("attempts")
      .select("id, status, started_at, score, correct_count, total_questions")
      .eq("quiz_id", id)
      .eq("user_id", profile.id)
      .order("started_at", { ascending: false }),
  ]);
  if (!quiz || quiz.status !== "published") notFound();

  const active = attempts?.find((a) => a.status === "in_progress");
  const done = (attempts ?? []).filter((a) => a.status === "submitted");

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <Link href="/quizzes" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {t.nav.quizzes}
      </Link>
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">{quiz.subjects?.name}</p>
        <h1 className="text-2xl font-semibold">{quiz.title}</h1>
        {quiz.description && <p className="whitespace-pre-line text-muted-foreground">{quiz.description}</p>}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-4" /> {t.quiz.questionsCount(quiz.quiz_versions?.question_count ?? 0)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-4" /> {t.quiz.durationShort(quiz.duration_minutes)}
          </span>
          <span>{t.exam.modeInfo[quiz.default_mode]}</span>
        </div>
      </div>

      <StartButton quizId={quiz.id} minutes={quiz.duration_minutes} activeAttemptId={active?.id} />

      <div className="grid gap-2">
        <h2 className="text-lg font-medium">{t.exam.yourAttempts}</h2>
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.exam.noAttempts}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {done.map((a) => (
              <li key={a.id}>
                <Link href={`/attempts/${a.id}/result`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted">
                  <span className="text-sm text-muted-foreground">{dateFmt.format(new Date(a.started_at))}</span>
                  <span className="text-sm">
                    {a.correct_count ?? 0}/{a.total_questions}
                  </span>
                  <span className="font-semibold">{a.score === null ? "–" : formatScore(Number(a.score))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
