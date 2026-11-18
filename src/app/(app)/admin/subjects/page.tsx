import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n/vi";
import { SubjectDialog, SubjectRowActions } from "./subject-dialog";

export default async function SubjectsPage() {
  const supabase = await createClient();
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, description, quizzes(count)")
    .order("name")
    .returns<{ id: string; name: string; description: string | null; quizzes: { count: number }[] }[]>();

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.subjects.title}</h1>
        <SubjectDialog />
      </div>
      {(subjects ?? []).length === 0 ? (
        <p className="text-muted-foreground">{t.subjects.empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {subjects!.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
              </div>
              <span className="text-sm text-muted-foreground">
                {t.subjects.quizCount(s.quizzes[0]?.count ?? 0)}
              </span>
              <SubjectRowActions subject={s} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
