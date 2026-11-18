import Link from "next/link";
import { Clock, ListChecks } from "lucide-react";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n/vi";

type Row = {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  subjects: { id: string; name: string } | null;
  quiz_versions: { question_count: number } | null;
};

export default async function QuizzesPage({ searchParams }: PageProps<"/quizzes">) {
  const { q } = await searchParams;
  const search = typeof q === "string" ? q.trim() : "";
  const supabase = await createClient();

  // RLS: students only see published quizzes. question_count comes from the current version.
  let query = supabase
    .from("quizzes")
    .select("id, title, description, duration_minutes, subjects(id, name), quiz_versions!quizzes_current_version_fk(question_count)")
    .eq("status", "published")
    .order("title");
  if (search) query = query.ilike("title", `%${search.replace(/[%_]/g, "")}%`);
  const { data: quizzes } = await query.returns<Row[]>();

  const groups = new Map<string, { name: string; items: Row[] }>();
  for (const quiz of quizzes ?? []) {
    const key = quiz.subjects?.id ?? "";
    if (!groups.has(key)) groups.set(key, { name: quiz.subjects?.name ?? "", items: [] });
    groups.get(key)!.items.push(quiz);
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.nav.quizzes}</h1>
        <form role="search" className="w-full sm:w-72">
          <Input name="q" defaultValue={search} placeholder={t.quiz.search} aria-label={t.quiz.search} className="h-10" />
        </form>
      </div>
      {groups.size === 0 && <p className="text-muted-foreground">{t.placeholder.quizzes}</p>}
      {[...groups.values()].map((g) => (
        <div key={g.name} className="grid gap-3">
          <h2 className="text-lg font-medium">{g.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((quiz) => (
              <Link
                key={quiz.id}
                href={`/quizzes/${quiz.id}`}
                className="grid gap-2 rounded-xl border p-4 transition-colors hover:bg-muted"
              >
                <span className="font-medium">{quiz.title}</span>
                {quiz.description && (
                  <span className="line-clamp-2 text-sm text-muted-foreground">{quiz.description}</span>
                )}
                <span className="flex gap-4 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="size-4" /> {t.quiz.questionsCount(quiz.quiz_versions?.question_count ?? 0)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-4" /> {t.quiz.durationShort(quiz.duration_minutes)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
