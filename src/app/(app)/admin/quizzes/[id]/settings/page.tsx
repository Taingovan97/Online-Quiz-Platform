import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n/vi";
import type { AnswerMode, QuizStatus } from "@/lib/quiz/types";
import { SettingsForm, StatusActions } from "./settings-form";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export default async function QuizSettingsPage({ params }: PageProps<"/admin/quizzes/[id]/settings">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: quiz }, { data: subjects }, { data: versions }] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, title, description, subject_id, duration_minutes, default_mode, status")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        title: string;
        description: string | null;
        subject_id: string;
        duration_minutes: number;
        default_mode: AnswerMode;
        status: QuizStatus;
      }>(),
    supabase.from("subjects").select("id, name").order("name"),
    supabase
      .from("quiz_versions")
      .select("version_no, question_count, published_at")
      .eq("quiz_id", id)
      .order("version_no", { ascending: false }),
  ]);
  if (!quiz) notFound();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <SettingsForm quiz={quiz} subjects={subjects ?? []} />
      <aside className="grid content-start gap-6">
        <StatusActions quizId={quiz.id} status={quiz.status} hasVersions={(versions ?? []).length > 0} />
        <div className="grid gap-2">
          <h2 className="font-medium">{t.quiz.versions}</h2>
          {(versions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.quiz.noVersions}</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {versions!.map((v) => (
                <li key={v.version_no} className="flex justify-between gap-2">
                  <span>v{v.version_no} · {t.quiz.questionsCount(v.question_count)}</span>
                  <span className="text-muted-foreground">{dateFmt.format(new Date(v.published_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
