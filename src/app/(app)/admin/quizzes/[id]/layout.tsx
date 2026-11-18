import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { QuizStatusBadge } from "@/components/status-badge";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n/vi";
import type { QuizStatus } from "@/lib/quiz/types";
import { QuizTabs } from "./quiz-tabs";

export default async function QuizLayout({ children, params }: LayoutProps<"/admin/quizzes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, title, status, subjects(name)")
    .eq("id", id)
    .maybeSingle<{ id: string; title: string; status: QuizStatus; subjects: { name: string } | null }>();
  if (!quiz) notFound();

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <Link href="/admin/quizzes" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> {t.quiz.library}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{quiz.title}</h1>
          <QuizStatusBadge status={quiz.status} />
        </div>
        <p className="text-sm text-muted-foreground">{quiz.subjects?.name}</p>
      </div>
      <QuizTabs id={quiz.id} />
      {children}
    </div>
  );
}
