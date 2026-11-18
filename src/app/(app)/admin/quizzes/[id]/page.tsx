import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadQuestions } from "@/server/quizzes";
import type { AnswerMode, QuizStatus } from "@/lib/quiz/types";
import { QuestionReview } from "./question-review";

export default async function QuizQuestionsPage({ params }: PageProps<"/admin/quizzes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, status, default_mode")
    .eq("id", id)
    .maybeSingle<{ id: string; status: QuizStatus; default_mode: AnswerMode }>();
  if (!quiz) notFound();

  // Admin RLS policies allow reading questions with the user's own session.
  const questions = await loadQuestions(supabase, id);

  return (
    <QuestionReview
      quiz={{ id: quiz.id, status: quiz.status, mode: quiz.default_mode }}
      questions={questions}
    />
  );
}
