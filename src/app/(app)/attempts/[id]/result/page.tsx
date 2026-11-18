import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { getAttemptResult } from "@/server/exam";
import { formatScore, gradeQuestion } from "@/lib/grading/grade";
import { t } from "@/lib/i18n/vi";
import { ResultList } from "./result-list";
import { RetakeButton } from "./retake-button";

function duration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return t.result.timeSpent(m, s);
}

export default async function ResultPage({ params, searchParams }: PageProps<"/attempts/[id]/result">) {
  const { id } = await params;
  const { filter } = await searchParams;
  const profile = await requireProfile();
  const res = await getAttemptResult(createAdminClient(), profile, id);
  if (!res.ok) {
    if (res.code === "CONFLICT") redirect(`/attempts/${id}`);
    notFound();
  }
  const { attempt, snapshot, answers } = res.data;
  const items = snapshot.questions.map((q) => ({
    question: { id: q.id, position: q.position, content: q.content, selectionType: q.selectionType, options: q.options },
    correct: q.correct,
    explanation: q.explanation,
    selected: answers[q.id] ?? [],
    result: gradeQuestion(q.correct, answers[q.id] ?? []),
  }));
  const isOwner = attempt.user_id === profile.id;

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="grid gap-4 rounded-xl border p-5 text-center">
        <p className="text-sm text-muted-foreground">{snapshot.subjectName}</p>
        <h1 className="text-xl font-semibold">{snapshot.title}</h1>
        <p className="text-5xl font-bold tabular-nums">
          {formatScore(Number(attempt.score ?? 0))}
          <span className="text-2xl font-medium text-muted-foreground"> / 10</span>
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
            <CircleCheck className="size-4" /> {attempt.correct_count} {t.result.correct}
          </span>
          <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
            <CircleX className="size-4" /> {attempt.incorrect_count} {t.result.incorrect}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CircleDashed className="size-4" /> {attempt.unanswered_count} {t.result.unanswered}
          </span>
          <span>{t.quiz.questionsCount(attempt.total_questions)}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {duration(new Date(attempt.submitted_at!).getTime() - new Date(attempt.started_at).getTime())}
          {attempt.submit_reason === "timeout" && <> · <strong>{t.result.timeout}</strong></>}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {isOwner && <RetakeButton quizId={attempt.quiz_id} />}
          <Button variant="outline" render={<Link href="/quizzes" />} nativeButton={false}>
            {t.result.backToList}
          </Button>
        </div>
      </div>
      <ResultList items={items} initialFilter={filter === "wrong" ? "wrong" : filter === "unanswered" ? "unanswered" : "all"} />
    </section>
  );
}
