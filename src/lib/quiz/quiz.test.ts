import { describe, expect, it } from "vitest";
import { applyQuestionEdit, contentHash, normalizeText } from "./edit";
import { buildSnapshot, redactSnapshot } from "./snapshot";
import type { QuestionDraft } from "./types";
import { validateQuiz } from "./validate";

function q(partial: Partial<QuestionDraft> & { correct?: string[] } = {}): QuestionDraft {
  const correct = partial.correct ?? ["B"];
  const { correct: _ignored, ...rest } = partial;
  void _ignored;
  return {
    id: crypto.randomUUID(),
    position: 1,
    content: "Câu hỏi?",
    selectionType: correct.length > 1 ? "multiple" : "single",
    explanation: null,
    answerStatus: "extracted_valid",
    answerSource: "pdf_extracted",
    originalAnswer: correct,
    options: ["A", "B", "C", "D"].map((label) => ({
      label,
      content: `Đáp án ${label}`,
      isCorrect: correct.includes(label),
    })),
    ...rest,
  };
}

describe("validateQuiz", () => {
  it("passes a clean single-answer quiz", () => {
    expect(validateQuiz("single", [q(), q({ position: 2, correct: ["A"] })])).toEqual([]);
  });

  it("requires at least one question", () => {
    expect(validateQuiz("single", [])).toEqual([{ code: "NO_QUESTIONS" }]);
  });

  it("flags too few options and no correct option", () => {
    const one = q({ options: [{ label: "A", content: "x", isCorrect: true }] });
    const none = q({ position: 2, correct: [] });
    const codes = validateQuiz("single", [one, none]).map((i) => i.code);
    expect(codes).toContain("TOO_FEW_OPTIONS");
    expect(codes).toContain("NO_CORRECT");
  });

  it("single questions need exactly one correct option", () => {
    const bad = q({ correct: ["A", "B"], selectionType: "single" });
    expect(validateQuiz("mixed", [bad]).map((i) => i.code)).toEqual(["SINGLE_NEEDS_ONE"]);
  });

  it("Mode B: every question must have ≥ 2 correct options", () => {
    const ok = q({ correct: ["A", "C"] });
    const lone = q({ position: 2, correct: ["B"], selectionType: "multiple" });
    const issues = validateQuiz("multiple", [ok, lone]);
    expect(issues).toEqual([{ code: "MULTIPLE_NEEDS_TWO", questionId: lone.id, position: 2 }]);
  });

  it("flags questions whose selection type differs from a fixed quiz mode", () => {
    const multi = q({ correct: ["A", "C"] });
    expect(validateQuiz("single", [multi]).map((i) => i.code)).toEqual(["MODE_MISMATCH"]);
    expect(validateQuiz("mixed", [multi, q({ position: 2 })])).toEqual([]);
  });

  it("requires a resolved answer status", () => {
    for (const status of ["missing", "invalid", "ambiguous", "ai_suggested"] as const) {
      expect(validateQuiz("single", [q({ answerStatus: status })]).map((i) => i.code)).toEqual([
        "UNVERIFIED",
      ]);
    }
    expect(validateQuiz("single", [q({ answerStatus: "verified" })])).toEqual([]);
  });
});

describe("applyQuestionEdit", () => {
  const existing = q({ correct: ["B"] });

  it("relabels options A, B, C… in the given order and trims text", () => {
    const res = applyQuestionEdit(existing, {
      content: "  Nội dung   mới ",
      selectionType: "single",
      explanation: "",
      options: [
        { content: " Một ", isCorrect: false },
        { content: "Hai", isCorrect: true },
        { content: "Ba", isCorrect: false },
      ],
    });
    expect(res.options.map((o) => o.label)).toEqual(["A", "B", "C"]);
    expect(res.options[0].content).toBe("Một");
    expect(res.fields.content).toBe("Nội dung mới");
    expect(res.fields.explanation).toBeNull();
  });

  it("keeps status/source when only wording changes", () => {
    const res = applyQuestionEdit(existing, {
      content: "Khác",
      selectionType: "single",
      explanation: null,
      options: existing.options.map((o) => ({ content: o.content + "!", isCorrect: o.isCorrect })),
    });
    expect(res.fields.answer_status).toBe("extracted_valid");
    expect(res.fields.answer_source).toBe("pdf_extracted");
  });

  it("marks the answer manually verified when the correct set changes", () => {
    const res = applyQuestionEdit(existing, {
      content: existing.content,
      selectionType: "single",
      explanation: null,
      options: existing.options.map((o) => ({ content: o.content, isCorrect: o.label === "C" })),
    });
    expect(res.fields.answer_status).toBe("verified");
    expect(res.fields.answer_source).toBe("manually_verified");
  });

  it("marks a question missing when no option is correct", () => {
    const res = applyQuestionEdit(existing, {
      content: existing.content,
      selectionType: "single",
      explanation: null,
      options: existing.options.map((o) => ({ content: o.content, isCorrect: false })),
    });
    expect(res.fields.answer_status).toBe("missing");
    expect(res.fields.answer_source).toBeNull();
  });

  it("rejects more than 6 options or empty option text", () => {
    const base = { content: "x", selectionType: "single" as const, explanation: null };
    expect(() =>
      applyQuestionEdit(null, { ...base, options: Array.from({ length: 7 }, () => ({ content: "a", isCorrect: false })) }),
    ).toThrow();
    expect(() => applyQuestionEdit(null, { ...base, options: [{ content: "  ", isCorrect: true }] })).toThrow();
  });
});

describe("contentHash", () => {
  it("ignores case/whitespace/Unicode normalization of the stem but not option text", () => {
    const opts = [{ label: "A", content: "x" }];
    const nfd = "Thuế".normalize("NFD");
    expect(contentHash(`  ${nfd}  là gì `, opts, "single")).toBe(contentHash("thuế là gì", opts, "single"));
    expect(contentHash("thuế", opts, "single")).not.toBe(contentHash("thuế", opts, "multiple"));
    expect(contentHash("thuế", opts, "single")).not.toBe(
      contentHash("thuế", [{ label: "A", content: "y" }], "single"),
    );
  });

  it("normalizeText applies NFC and collapses whitespace", () => {
    expect(normalizeText("a \n\t b".normalize("NFD"))).toBe("a b");
    expect(normalizeText("thuế".normalize("NFD"))).toBe("thuế");
  });
});

describe("snapshots", () => {
  const quiz = { id: "quiz-1", title: "Đề 1", durationMinutes: 45, defaultMode: "single" as const };
  const questions = [q({ position: 2, correct: ["C"] }), q({ position: 1, correct: ["A"] })];

  it("orders by position and records sorted correct labels", () => {
    const snap = buildSnapshot(quiz, "Pháp luật", questions);
    expect(snap.questions.map((x) => x.position)).toEqual([1, 2]);
    expect(snap.questions[0].correct).toEqual(["A"]);
    expect(snap.subjectName).toBe("Pháp luật");
  });

  it("redaction removes answer keys and explanations", () => {
    const snap = buildSnapshot(quiz, "Pháp luật", [q({ explanation: "Vì…" })]);
    const red = redactSnapshot(snap);
    const json = JSON.stringify(red);
    expect(json).not.toContain("correct");
    expect(json).not.toContain("Vì…");
    expect(red.questions[0].options).toHaveLength(4);
  });
});

describe("sortForReview", () => {
  it("puts problems first, then AI, then warned rows, then the rest by position", async () => {
    const { sortForReview } = await import("./review");
    const rows = [
      { id: "ok1", position: 1, answerStatus: "extracted_valid" as const },
      { id: "ver", position: 2, answerStatus: "verified" as const },
      { id: "miss", position: 3, answerStatus: "missing" as const },
      { id: "ai", position: 4, answerStatus: "ai_suggested" as const },
      { id: "inv", position: 5, answerStatus: "invalid" as const },
      { id: "warn", position: 6, answerStatus: "extracted_valid" as const },
    ];
    expect(sortForReview(rows, new Set(["warn"])).map((r) => r.id)).toEqual([
      "inv", "miss", "ai", "warn", "ok1", "ver",
    ]);
  });
});
