"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/confirm-button";
import { AnswerStatusBadge } from "@/components/status-badge";
import { t } from "@/lib/i18n/vi";
import { LABELS, type AnswerMode, type QuestionDraft, type SelectionType } from "@/lib/quiz/types";
import { deleteQuestionAction, saveQuestionAction } from "../actions";

type OptionState = { key: number; content: string; isCorrect: boolean };

let keySeq = 0;
const blankOptions = (): OptionState[] =>
  ["", "", "", ""].map((content) => ({ key: ++keySeq, content, isCorrect: false }));

export function QuestionEditor({
  quizId,
  mode,
  editable,
  question,
  open,
  warnings,
  onOpenChange,
  onSaved,
}: {
  quizId: string;
  mode: AnswerMode;
  editable: boolean;
  question: QuestionDraft | null;
  open: boolean;
  warnings?: string[];
  onOpenChange: (open: boolean) => void;
  /** Called with the saved id after "save & verify" (jump to next), or undefined otherwise. */
  onSaved: (jumpFrom?: string) => void;
}) {
  const title = question ? t.question.number(question.position) : t.question.add;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {question && (
            <SheetDescription render={<div />} className="flex flex-wrap items-center gap-2">
              <AnswerStatusBadge status={question.answerStatus} source={question.answerSource} />
              <span>
                {t.question.originalAnswer}: {question.originalAnswer?.join(", ") || t.question.none}
              </span>
              <span>
                · {t.question.currentSource}:{" "}
                {question.answerSource ? t.answerSource[question.answerSource] : t.question.none}
              </span>
            </SheetDescription>
          )}
        </SheetHeader>
        {open && (
          // Re-mounted per question so the form state initialises from props.
          <EditorForm
            key={question?.id ?? "new"}
            quizId={quizId}
            mode={mode}
            editable={editable}
            question={question}
            warnings={warnings}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditorForm({
  quizId,
  mode,
  editable,
  question,
  warnings,
  onSaved,
}: {
  quizId: string;
  mode: AnswerMode;
  editable: boolean;
  question: QuestionDraft | null;
  warnings?: string[];
  onSaved: (jumpFrom?: string) => void;
}) {
  const [content, setContent] = useState(question?.content ?? "");
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [selectionType, setSelectionType] = useState<SelectionType>(
    question?.selectionType ?? (mode === "multiple" ? "multiple" : "single"),
  );
  const [options, setOptions] = useState<OptionState[]>(() =>
    question
      ? question.options.map((o) => ({ key: ++keySeq, content: o.content, isCorrect: o.isCorrect }))
      : blankOptions(),
  );
  const [pending, startTransition] = useTransition();

  const typeLocked = mode !== "mixed";
  const effectiveType: SelectionType = typeLocked ? (mode as SelectionType) : selectionType;

  function setCorrect(index: number, checked: boolean) {
    setOptions((opts) =>
      opts.map((o, i) =>
        effectiveType === "single"
          ? { ...o, isCorrect: i === index ? checked : false }
          : i === index
            ? { ...o, isCorrect: checked }
            : o,
      ),
    );
  }

  function move(index: number, delta: number) {
    setOptions((opts) => {
      const next = [...opts];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  }

  function save(verify: boolean) {
    startTransition(async () => {
      const res = await saveQuestionAction(
        quizId,
        question?.id ?? null,
        {
          content,
          selectionType: effectiveType,
          explanation: explanation || null,
          options: options.map((o) => ({ content: o.content, isCorrect: o.isCorrect })),
        },
        verify,
      );
      if (res.ok) {
        toast.success(t.question.saved);
        onSaved(verify ? res.data.id : undefined);
      } else toast.error(res.message);
    });
  }

  return (
        <form
          className="grid gap-5 px-4 pb-6"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && editable) {
              e.preventDefault();
              save(true);
            }
          }}
        >
          {warnings?.map((w) => (
            <p key={w} className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              ⚠ {w}
            </p>
          ))}

          <div className="grid gap-2">
            <Label htmlFor="q-content">{t.question.content}</Label>
            <Textarea
              id="q-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              required
              disabled={!editable}
            />
          </div>

          <fieldset className="grid gap-2" disabled={!editable || typeLocked}>
            <legend className="mb-2 text-sm font-medium">{t.question.selectionType}</legend>
            <div className="flex gap-2">
              {(["single", "multiple"] as const).map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant={effectiveType === type ? "secondary" : "outline"}
                  aria-pressed={effectiveType === type}
                  onClick={() => {
                    setSelectionType(type);
                    if (type === "single") {
                      // Keep only the first correct option when switching to single.
                      let seen = false;
                      setOptions((opts) =>
                        opts.map((o) => {
                          const keep = o.isCorrect && !seen;
                          if (o.isCorrect) seen = true;
                          return { ...o, isCorrect: keep };
                        }),
                      );
                    }
                  }}
                >
                  {t.quiz.modes[type]}
                </Button>
              ))}
            </div>
            {typeLocked && <p className="text-xs text-muted-foreground">{t.question.modeLocked}</p>}
          </fieldset>

          <fieldset className="grid gap-2" disabled={!editable}>
            <legend className="mb-2 text-sm font-medium">{t.question.options}</legend>
            {options.map((o, i) => (
              <div key={o.key} className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 font-semibold">{LABELS[i]}</span>
                <Textarea
                  value={o.content}
                  onChange={(e) =>
                    setOptions((opts) => opts.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))
                  }
                  rows={1}
                  aria-label={`${t.question.options} ${LABELS[i]}`}
                  required
                  className="min-h-10 flex-1"
                />
                <label className="mt-2 flex shrink-0 items-center gap-1 text-sm">
                  <input
                    type={effectiveType === "single" ? "radio" : "checkbox"}
                    name="correct"
                    className="size-4"
                    checked={o.isCorrect}
                    onChange={(e) => setCorrect(i, e.target.checked)}
                  />
                  {t.question.correct}
                </label>
                <div className="flex shrink-0 flex-col">
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t.question.moveUp} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t.question.moveDown} disabled={i === options.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mt-1"
                  aria-label={t.question.removeOption}
                  disabled={options.length <= 2}
                  onClick={() => setOptions((opts) => opts.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            ))}
            {options.length < LABELS.length && editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setOptions((opts) => [...opts, { key: ++keySeq, content: "", isCorrect: false }])}
              >
                <Plus /> {t.question.addOption}
              </Button>
            )}
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="q-explanation">{t.question.explanation}</Label>
            <Textarea
              id="q-explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={3}
              disabled={!editable}
            />
          </div>

          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="outline" disabled={pending}>
                {t.question.save}
              </Button>
              <Button type="button" disabled={pending} onClick={() => save(true)} title="Ctrl/⌘ + Enter">
                {t.question.saveVerify}
              </Button>
              {question && (
                <div className="ml-auto">
                  <ConfirmButton
                    title={t.question.confirmDelete}
                    confirmLabel={t.question.delete}
                    trigger={<Button type="button" variant="ghost" aria-label={t.question.delete} />}
                    onConfirm={async () => {
                      const res = await deleteQuestionAction(quizId, question.id);
                      if (res.ok) {
                        toast.success(t.question.deleted);
                        onSaved(undefined);
                      } else toast.error(res.message);
                    }}
                  >
                    <Trash2 /> {t.question.delete}
                  </ConfirmButton>
                </div>
              )}
            </div>
          )}
        </form>
  );
}
