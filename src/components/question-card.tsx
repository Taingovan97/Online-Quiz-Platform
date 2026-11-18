"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/vi";
import type { SelectionType } from "@/lib/quiz/types";

export type CardQuestion = {
  id: string;
  position: number;
  content: string;
  selectionType: SelectionType;
  options: { label: string; content: string }[];
};

/**
 * One question as a <fieldset>. Modes:
 * - "exam"/"preview": interactive radios/checkboxes.
 * - "result": read-only, highlights correct options and the student's wrong picks.
 */
export function QuestionCard({
  question,
  selected,
  onChange,
  mode,
  correct,
  explanation,
  disabled,
  headerExtra,
}: {
  question: CardQuestion;
  selected: string[];
  onChange?: (labels: string[]) => void;
  mode: "exam" | "preview" | "result";
  correct?: string[];
  explanation?: string | null;
  disabled?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const multiple = question.selectionType === "multiple";
  const readOnly = mode === "result" || disabled;
  const name = `q-${question.id}`;

  function toggle(label: string, checked: boolean) {
    if (!onChange) return;
    if (multiple) {
      onChange(checked ? [...selected, label].sort() : selected.filter((l) => l !== label));
    } else if (checked) onChange([label]);
  }

  return (
    <fieldset id={`question-${question.position}`} className="grid scroll-mt-24 gap-3 rounded-xl border p-4">
      <legend className="sr-only">{t.question.number(question.position)}</legend>
      <div className="flex items-center gap-2">
        <span className="font-semibold">{t.question.number(question.position)}</span>
        {headerExtra}
      </div>
      <p className="whitespace-pre-line text-[17px] leading-relaxed">{question.content}</p>
      {multiple && <p className="text-sm text-muted-foreground">{t.question.multipleHint}</p>}

      <div className="grid gap-2">
        {question.options.map((o) => {
          const isSelected = selected.includes(o.label);
          const isCorrect = correct?.includes(o.label) ?? false;
          const resultCls =
            mode === "result"
              ? isCorrect
                ? "border-green-500 bg-green-50 dark:bg-green-950"
                : isSelected
                  ? "border-red-500 bg-red-50 dark:bg-red-950"
                  : ""
              : "";
          return (
            <label
              key={o.label}
              className={cn(
                "flex min-h-11 items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                !readOnly && "cursor-pointer hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-muted",
                resultCls,
              )}
            >
              <input
                type={multiple ? "checkbox" : "radio"}
                name={name}
                value={o.label}
                className="mt-1 size-4 shrink-0"
                checked={isSelected}
                disabled={readOnly}
                onChange={(e) => toggle(o.label, e.target.checked)}
              />
              <span className="w-5 shrink-0 font-semibold">{o.label}</span>
              <span className="flex-1 leading-relaxed">{o.content}</span>
              {mode === "result" && isCorrect && <Check className="mt-1 size-4 shrink-0 text-green-600" aria-label={t.result.correctAnswer} />}
              {mode === "result" && isSelected && !isCorrect && <X className="mt-1 size-4 shrink-0 text-red-600" aria-label={t.result.yourWrongPick} />}
            </label>
          );
        })}
      </div>
      {!multiple && !readOnly && selected.length > 0 && onChange && (
        <button type="button" className="w-fit text-sm text-muted-foreground underline" onClick={() => onChange([])}>
          {t.exam.clear}
        </button>
      )}
      {mode === "result" && explanation && (
        <p className="rounded-lg bg-muted p-3 text-sm">💡 {t.result.explanation}: {explanation}</p>
      )}
    </fieldset>
  );
}
