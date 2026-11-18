"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCheck, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AnswerStatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/vi";
import { PROBLEM_STATUSES, reviewSummary, sortForReview } from "@/lib/quiz/review";
import type { AnswerMode, QuestionDraft, QuizStatus, ValidationIssue } from "@/lib/quiz/types";
import { publishQuizAction, verifyQuestionsAction } from "../actions";
import { AiButton } from "./ai-button";
import { QuestionEditor } from "./question-editor";

type Filter = keyof typeof t.question.filters;

export type ReviewExtras = {
  /** Per-question review warnings (e.g. from PDF import), keyed by question id. */
  warnings?: Record<string, string[]>;
  /** Present when an AI provider is configured on the server. */
  ai?: { model: string };
  banner?: React.ReactNode;
};

export function QuestionReview({
  quiz,
  questions,
  warnings = {},
  ai,
  banner,
}: {
  quiz: { id: string; status: QuizStatus; mode: AnswerMode };
  questions: QuestionDraft[];
} & ReviewExtras) {
  const editable = quiz.status === "draft";
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<QuestionDraft | "new" | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [pending, startTransition] = useTransition();

  const warned = useMemo(() => new Set(Object.keys(warnings)), [warnings]);
  const summary = reviewSummary(questions);
  const visible = useMemo(() => {
    const sorted = sortForReview(questions, warned);
    switch (filter) {
      case "problems":
        return sorted.filter((q) => PROBLEM_STATUSES.includes(q.answerStatus) || warned.has(q.id));
      case "ai":
        return sorted.filter((q) => q.answerStatus === "ai_suggested");
      case "ok":
        return sorted.filter((q) => q.answerStatus === "verified" || q.answerStatus === "extracted_valid");
      default:
        return sorted;
    }
  }, [questions, warned, filter]);

  const allVisibleSelected = visible.length > 0 && visible.every((q) => selected.has(q.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function verify() {
    startTransition(async () => {
      const res = await verifyQuestionsAction(quiz.id, [...selected]);
      if (res.ok) {
        toast.success(t.question.verified(res.data.verified, res.data.skipped));
        setSelected(new Set());
      } else toast.error(res.message);
    });
  }

  function publish() {
    startTransition(async () => {
      const res = await publishQuizAction(quiz.id);
      if (!res.ok) toast.error(res.message);
      else if (res.data.published) toast.success(t.quiz.published(res.data.versionNo));
      else setIssues(res.data.issues);
    });
  }

  const byId = new Map(questions.map((q) => [q.id, q]));

  return (
    <div className="grid gap-4">
      {banner}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["total", summary.total],
            ["fromPdf", summary.fromPdf],
            ["ai", summary.ai],
            ["needsReview", summary.needsReview],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className={cn("rounded-lg border p-3", key === "needsReview" && value > 0 && "border-red-300 dark:border-red-900")}>
            <p className="text-xs text-muted-foreground">{t.question.summary[key]}</p>
            <p className="text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {!editable && (
        <Alert>
          <AlertDescription>{t.quiz.lockedNotice}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="Lọc">
          {(Object.keys(t.question.filters) as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "secondary" : "ghost"}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {t.question.filters[f]}
            </Button>
          ))}
        </div>
        {editable && (
          <>
            <label className="ml-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={allVisibleSelected}
                onChange={() =>
                  setSelected(allVisibleSelected ? new Set() : new Set(visible.map((q) => q.id)))
                }
              />
              {t.question.selectAll}
            </label>
            <div className="ml-auto flex flex-wrap gap-2">
              {ai && (
                <AiButton
                  quizId={quiz.id}
                  model={ai.model}
                  questionIds={
                    selected.size
                      ? [...selected]
                      : questions.filter((q) => PROBLEM_STATUSES.includes(q.answerStatus)).map((q) => q.id)
                  }
                  onDone={() => setSelected(new Set())}
                />
              )}
              <Button variant="outline" disabled={selected.size === 0 || pending} onClick={verify}>
                <CheckCheck /> {t.question.verifySelected(selected.size)}
              </Button>
              <Button variant="outline" onClick={() => setEditing("new")}>
                <Plus /> {t.question.add}
              </Button>
              <Button disabled={pending} onClick={publish}>
                <Send /> {t.quiz.publish}
              </Button>
            </div>
          </>
        )}
      </div>

      {questions.length === 0 ? (
        <p className="text-muted-foreground">{t.question.empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {visible.map((q) => {
            const correct = q.options.filter((o) => o.isCorrect).map((o) => o.label);
            return (
              <li key={q.id} className="flex items-start gap-3 p-3">
                {editable && (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    aria-label={t.question.number(q.position)}
                    checked={selected.has(q.id)}
                    onChange={() => toggle(q.id)}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setEditing(q)}
                  className="grid min-w-0 flex-1 gap-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t.question.number(q.position)}</span>
                    <AnswerStatusBadge status={q.answerStatus} source={q.answerSource} />
                    {q.selectionType === "multiple" && (
                      <span className="text-xs text-muted-foreground">{t.quiz.modes.multiple}</span>
                    )}
                    {correct.length > 0 && (
                      <span className="ml-auto font-mono text-sm">✓ {correct.join(", ")}</span>
                    )}
                  </span>
                  <span className="line-clamp-2 text-sm text-muted-foreground">{q.content}</span>
                  {warnings[q.id]?.map((w) => (
                    <span key={w} className="text-xs text-amber-700 dark:text-amber-400">
                      ⚠ {w}
                    </span>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <QuestionEditor
        quizId={quiz.id}
        mode={quiz.mode}
        editable={editable}
        question={editing === "new" ? null : editing}
        open={editing !== null}
        warnings={editing && editing !== "new" ? warnings[editing.id] : undefined}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={(nextId) => {
          // Jump to the next unresolved question after "save & verify".
          if (nextId === undefined) return setEditing(null);
          const next = sortForReview(questions, warned).find(
            (q) => q.id !== nextId && (PROBLEM_STATUSES.includes(q.answerStatus) || q.answerStatus === "ai_suggested"),
          );
          setEditing(next ?? null);
        }}
      />

      <Dialog open={issues !== null} onOpenChange={(o) => !o && setIssues(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.quiz.publish}</DialogTitle>
            <DialogDescription>{t.quiz.publishBlocked}</DialogDescription>
          </DialogHeader>
          <ul className="grid max-h-80 gap-1 overflow-y-auto text-sm">
            {issues?.map((issue, i) => {
              const q = issue.questionId ? byId.get(issue.questionId) : undefined;
              return (
                <li key={i}>
                  {q ? (
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => {
                        setIssues(null);
                        setEditing(q);
                      }}
                    >
                      <strong>{t.question.number(q.position)}:</strong> {t.issues[issue.code]}
                    </button>
                  ) : (
                    t.issues[issue.code]
                  )}
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
