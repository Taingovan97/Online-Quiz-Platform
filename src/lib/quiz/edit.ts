import { createHash } from "node:crypto";
import { LABELS, type AnswerSource, type AnswerStatus, type QuestionDraft, type SelectionType } from "./types";

export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Stable identity of a question's content, used for AI caching and duplicate detection. */
export function contentHash(
  stem: string,
  options: { label: string; content: string }[],
  selectionType: SelectionType,
): string {
  const opts = [...options]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((o) => `${o.label}:${normalizeText(o.content)}`)
    .join("\u0000");
  return createHash("sha256")
    .update(`${normalizeText(stem).toLowerCase()}\u0000${opts}\u0000${selectionType}`)
    .digest("hex");
}

export type QuestionEditInput = {
  content: string;
  selectionType: SelectionType;
  explanation: string | null;
  options: { content: string; isCorrect: boolean }[];
};

export type QuestionWrite = {
  fields: {
    content: string;
    selection_type: SelectionType;
    explanation: string | null;
    answer_status: AnswerStatus;
    answer_source: AnswerSource | null;
    content_hash: string;
  };
  options: { label: string; content: string; is_correct: boolean }[];
};

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Turns an admin edit into the row values to store.
 * - Options are relabelled A, B, C… in the given order.
 * - Changing which options are correct ⇒ verified + manually_verified.
 * - Wording-only edits keep the existing status and source.
 * Throws on structurally invalid input (callers validate with zod first).
 */
export function applyQuestionEdit(existing: QuestionDraft | null, input: QuestionEditInput): QuestionWrite {
  if (input.options.length > LABELS.length) throw new Error("Too many options");
  const content = normalizeText(input.content);
  if (!content) throw new Error("Empty question");

  const options = input.options.map((o, i) => {
    const text = normalizeText(o.content);
    if (!text) throw new Error("Empty option");
    return { label: LABELS[i], content: text, is_correct: o.isCorrect };
  });
  const newCorrect = options.filter((o) => o.is_correct).map((o) => o.label);
  const oldCorrect = existing?.options.filter((o) => o.isCorrect).map((o) => o.label) ?? [];

  let answer_status: AnswerStatus;
  let answer_source: AnswerSource | null;
  if (newCorrect.length === 0) {
    answer_status = "missing";
    answer_source = null;
  } else if (existing && sameSet(oldCorrect, newCorrect) && existing.answerSource) {
    answer_status = existing.answerStatus;
    answer_source = existing.answerSource;
  } else {
    answer_status = "verified";
    answer_source = "manually_verified";
  }

  const explanation = input.explanation ? input.explanation.trim() || null : null;
  return {
    fields: {
      content,
      selection_type: input.selectionType,
      explanation,
      answer_status,
      answer_source,
      content_hash: contentHash(content, options, input.selectionType),
    },
    options,
  };
}
