export type AnswerMode = "single" | "multiple" | "mixed";
export type SelectionType = "single" | "multiple";
export type AnswerStatus =
  | "extracted_valid"
  | "missing"
  | "invalid"
  | "ambiguous"
  | "ai_suggested"
  | "verified";
export type AnswerSource = "pdf_extracted" | "ai_generated" | "manually_verified";
export type QuizStatus = "draft" | "published" | "archived";

export const LABELS = ["A", "B", "C", "D", "E", "F"] as const;
export type Label = (typeof LABELS)[number];

export type OptionDraft = { label: string; content: string; isCorrect: boolean };

export type QuestionDraft = {
  id: string;
  position: number;
  content: string;
  selectionType: SelectionType;
  explanation: string | null;
  answerStatus: AnswerStatus;
  answerSource: AnswerSource | null;
  originalAnswer: string[] | null;
  options: OptionDraft[];
};

export type QuizSnapshot = {
  quizId: string;
  versionNo: number;
  title: string;
  subjectName: string;
  durationMinutes: number;
  mode: AnswerMode;
  questions: Array<{
    id: string;
    position: number;
    content: string;
    selectionType: SelectionType;
    options: Array<{ label: string; content: string }>;
    correct: string[];
    explanation: string | null;
  }>;
};

/** What a student may see before submitting: no key, no explanations. */
export type RedactedSnapshot = Omit<QuizSnapshot, "questions"> & {
  questions: Array<Omit<QuizSnapshot["questions"][number], "correct" | "explanation">>;
};

export type ValidationIssueCode =
  | "NO_QUESTIONS"
  | "TOO_FEW_OPTIONS"
  | "NO_CORRECT"
  | "SINGLE_NEEDS_ONE"
  | "MULTIPLE_NEEDS_TWO"
  | "MODE_MISMATCH"
  | "UNVERIFIED";

export type ValidationIssue = {
  code: ValidationIssueCode;
  questionId?: string;
  position?: number;
};
