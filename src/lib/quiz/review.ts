import type { AnswerStatus, QuestionDraft } from "./types";

export const PROBLEM_STATUSES: AnswerStatus[] = ["invalid", "ambiguous", "missing"];

const rank: Record<AnswerStatus, number> = {
  invalid: 0,
  ambiguous: 1,
  missing: 2,
  ai_suggested: 3,
  extracted_valid: 5,
  verified: 6,
};

/** Review order: problems first, then AI suggestions, then warned rows, then the rest (by position). */
export function sortForReview<T extends Pick<QuestionDraft, "id" | "position" | "answerStatus">>(
  questions: T[],
  warned: Set<string> = new Set(),
): T[] {
  const score = (q: T) => (warned.has(q.id) && rank[q.answerStatus] >= 5 ? 4 : rank[q.answerStatus]);
  return [...questions].sort((a, b) => score(a) - score(b) || a.position - b.position);
}

export function reviewSummary(questions: Pick<QuestionDraft, "answerStatus" | "answerSource">[]) {
  return {
    total: questions.length,
    fromPdf: questions.filter((q) => q.answerSource === "pdf_extracted").length,
    ai: questions.filter((q) => q.answerStatus === "ai_suggested" || q.answerSource === "ai_generated").length,
    needsReview: questions.filter((q) => PROBLEM_STATUSES.includes(q.answerStatus) || q.answerStatus === "ai_suggested").length,
  };
}
