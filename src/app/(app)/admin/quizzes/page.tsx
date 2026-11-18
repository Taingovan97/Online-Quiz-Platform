import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { QuizStatusBadge } from "@/components/status-badge";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n/vi";
import type { QuizStatus } from "@/lib/quiz/types";
import { NewQuizDialog } from "./new-quiz-dialog";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short" });

type Row = {
  id: string;
  title: string;
  status: QuizStatus;
  updated_at: string;
  subjects: { name: string } | null;
  questions: { count: number }[];
};

export default async function AdminQuizzesPage({ searchParams }: PageProps<"/admin/quizzes">) {
  const { status, subject } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("quizzes")
    .select("id, title, status, updated_at, subjects(name), questions(count)")
    .order("updated_at", { ascending: false });
  if (typeof status === "string" && ["draft", "published", "archived"].includes(status)) {
    query = query.eq("status", status);
  }
  if (typeof subject === "string" && subject) query = query.eq("subject_id", subject);

  const [{ data: quizzes }, { data: subjects }] = await Promise.all([
    query.returns<Row[]>(),
    supabase.from("subjects").select("id, name").order("name"),
  ]);

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.quiz.library}</h1>
        <div className="flex gap-2">
          <NewQuizDialog subjects={subjects ?? []} />
          <Button className="h-10" render={<Link href="/admin/imports/new" />} nativeButton={false}>
            {t.imports.title}
          </Button>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2" role="search">
        <NativeSelect name="status" defaultValue={typeof status === "string" ? status : ""} className="w-auto" aria-label={t.quiz.status}>
          <option value="">{t.quiz.allStatuses}</option>
          <option value="draft">{t.quiz.statuses.draft}</option>
          <option value="published">{t.quiz.statuses.published}</option>
          <option value="archived">{t.quiz.statuses.archived}</option>
        </NativeSelect>
        <NativeSelect name="subject" defaultValue={typeof subject === "string" ? subject : ""} className="w-auto" aria-label={t.quiz.subject}>
          <option value="">{t.quiz.allSubjects}</option>
          {(subjects ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline" className="h-10">
          Lọc
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.quiz.title}</TableHead>
              <TableHead>{t.quiz.subject}</TableHead>
              <TableHead>{t.quiz.status}</TableHead>
              <TableHead className="text-right">{t.quiz.questions}</TableHead>
              <TableHead className="text-right">{t.quiz.updated}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(quizzes ?? []).map((q) => (
              <TableRow key={q.id}>
                <TableCell className="font-medium">
                  <Link href={`/admin/quizzes/${q.id}`} className="hover:underline">
                    {q.title}
                  </Link>
                </TableCell>
                <TableCell>{q.subjects?.name}</TableCell>
                <TableCell>
                  <QuizStatusBadge status={q.status} />
                </TableCell>
                <TableCell className="text-right">{q.questions[0]?.count ?? 0}</TableCell>
                <TableCell className="text-right">{dateFmt.format(new Date(q.updated_at))}</TableCell>
              </TableRow>
            ))}
            {(quizzes ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {t.quiz.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
