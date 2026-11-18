import type { AnswerMode, QuestionDraft, ValidationIssue } from "./types";

const RESOLVED = new Set(["extracted_valid", "verified"]);

/** Publish rules (docs/design.md §B.4). Returns [] when the quiz may be published. */
export function validateQuiz(mode: AnswerMode, questions: QuestionDraft[]): ValidationIssue[] {
  if (questions.length === 0) return [{ code: "NO_QUESTIONS" }];

  const issues: ValidationIssue[] = [];
  for (const q of [...questions].sort((a, b) => a.position - b.position)) {
    const at = { questionId: q.id, position: q.position };
    const correct = q.options.filter((o) => o.isCorrect).length;

    if (q.options.length < 2) issues.push({ code: "TOO_FEW_OPTIONS", ...at });

    if (correct === 0) {
      issues.push({ code: "NO_CORRECT", ...at });
    } else if (q.selectionType === "single" && correct !== 1) {
      issues.push({ code: "SINGLE_NEEDS_ONE", ...at });
    } else if (q.selectionType === "multiple" && correct < 2) {
      issues.push({ code: "MULTIPLE_NEEDS_TWO", ...at });
    }

    if (mode !== "mixed" && q.selectionType !== mode) issues.push({ code: "MODE_MISMATCH", ...at });
    if (!RESOLVED.has(q.answerStatus)) issues.push({ code: "UNVERIFIED", ...at });
  }
  return issues;
}
