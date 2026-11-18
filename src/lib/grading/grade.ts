/** Deterministic grading (SRD FR-07). Never uses AI. */

export type QuestionResult = "correct" | "incorrect" | "unanswered";

const norm = (labels: string[]) => [...new Set(labels.map((l) => l.trim().toUpperCase()))].sort().join(",");

/** Exact-set match; no partial credit. */
export function gradeQuestion(correct: string[], selected: string[]): QuestionResult {
  if (selected.length === 0) return "unanswered";
  return norm(correct) === norm(selected) ? "correct" : "incorrect";
}

export function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // Number.EPSILON nudges values like 2.675 that are stored as 2.67499…
  return Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * factor) / factor;
}

export function gradeAttempt(
  snapshot: { questions: { id: string; correct: string[] }[] },
  answers: Map<string, string[]>,
) {
  const perQuestion = new Map<string, QuestionResult>();
  let correct = 0;
  let incorrect = 0;
  for (const q of snapshot.questions) {
    const result = gradeQuestion(q.correct, answers.get(q.id) ?? []);
    perQuestion.set(q.id, result);
    if (result === "correct") correct++;
    else if (result === "incorrect") incorrect++;
  }
  const total = snapshot.questions.length;
  return {
    perQuestion,
    total,
    correct,
    incorrect,
    unanswered: total - correct - incorrect,
    // Raw score stored with 4 decimals (requirements A4).
    score: total === 0 ? 0 : roundHalfUp((correct / total) * 10, 4),
  };
}

const scoreFmt = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Display policy: half-up to 2 decimals, Vietnamese formatting ("7,14"). */
export function formatScore(score: number): string {
  return scoreFmt.format(roundHalfUp(score, 2));
}
