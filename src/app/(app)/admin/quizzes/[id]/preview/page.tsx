import { createClient } from "@/lib/supabase/server";
import { loadQuestions } from "@/server/quizzes";
import { t } from "@/lib/i18n/vi";
import { PreviewList } from "./preview-list";

export default async function QuizPreviewPage({ params }: PageProps<"/admin/quizzes/[id]/preview">) {
  const { id } = await params;
  const questions = await loadQuestions(await createClient(), id);
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <p className="text-sm text-muted-foreground">{t.exam.previewNotice}</p>
      <PreviewList
        questions={questions.map((q) => ({
          id: q.id,
          position: q.position,
          content: q.content,
          selectionType: q.selectionType,
          options: q.options.map((o) => ({ label: o.label, content: o.content })),
        }))}
      />
    </div>
  );
}
