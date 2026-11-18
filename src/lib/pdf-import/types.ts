import type { AnswerStatus, SelectionType } from "@/lib/quiz/types";

export type ParseWarningCode =
  | "COUNT_MISMATCH"
  | "ORPHAN_KEY_ENTRY"
  | "DUPLICATE_NUMBER"
  | "NUMBER_GAP"
  | "GRID_MISMATCH"
  | "TOO_FEW_OPTIONS"
  | "STRAY_TEXT"
  | "LETTER_REFERENCE"
  | "NO_ANSWER_KEY"
  | "DUPLICATE_KEY_ENTRY"
  | "DUPLICATE_FILE";

export type ParseWarning = { code: ParseWarningCode; questionNumber?: number; detail: string };

export type ParsedQuestion = {
  number: number;
  stem: string;
  options: { label: string; content: string }[];
  /** Labels as extracted from the key (null when no entry). Stored as original_answer. */
  answer: string[] | null;
  explanation: string | null;
  selectionType: SelectionType;
  status: AnswerStatus;
};

export type ImportSummary = {
  total: number;
  extractedValid: number;
  missing: number;
  invalid: number;
  ambiguous: number;
  keyFound: boolean;
};

export type ParsedQuiz = {
  title: string | null;
  expectedCount: number | null;
  questions: ParsedQuestion[];
  warnings: ParseWarning[];
  summary: ImportSummary;
};
