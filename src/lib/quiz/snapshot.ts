import type { AnswerMode, QuestionDraft, QuizSnapshot, RedactedSnapshot } from "./types";

export function buildSnapshot(
  quiz: { id: string; title: string; durationMinutes: number; defaultMode: AnswerMode },
  subjectName: string,
  questions: QuestionDraft[],
): QuizSnapshot {
  return {
    quizId: quiz.id,
    versionNo: 0, // assigned by publish_quiz()
    title: quiz.title,
    subjectName,
    durationMinutes: quiz.durationMinutes,
    mode: quiz.defaultMode,
    questions: [...questions]
      .sort((a, b) => a.position - b.position)
      .map((q) => ({
        id: q.id,
        position: q.position,
        content: q.content,
        selectionType: q.selectionType,
        options: [...q.options]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((o) => ({ label: o.label, content: o.content })),
        correct: q.options
          .filter((o) => o.isCorrect)
          .map((o) => o.label)
          .sort(),
        explanation: q.explanation,
      })),
  };
}

export function redactSnapshot(s: QuizSnapshot): RedactedSnapshot {
  return {
    ...s,
    questions: s.questions.map((q) => ({
      id: q.id,
      position: q.position,
      content: q.content,
      selectionType: q.selectionType,
      options: q.options,
    })),
  };
}
