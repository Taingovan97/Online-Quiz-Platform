import { AlertTriangle, CheckCheck, CircleAlert, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/vi";
import type { AnswerSource, AnswerStatus, QuizStatus } from "@/lib/quiz/types";

const answerStyles: Record<AnswerStatus, { cls: string; Icon: typeof FileText }> = {
  missing: { cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", Icon: CircleAlert },
  invalid: { cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", Icon: CircleAlert },
  ambiguous: { cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", Icon: AlertTriangle },
  ai_suggested: { cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900", Icon: Sparkles },
  extracted_valid: { cls: "bg-muted text-muted-foreground border-border", Icon: FileText },
  verified: { cls: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900", Icon: CheckCheck },
};

export function AnswerStatusBadge({ status, source }: { status: AnswerStatus; source?: AnswerSource | null }) {
  const { cls, Icon } = answerStyles[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium", cls)}>
      <Icon className="size-3.5" aria-hidden />
      {t.answerStatus[status]}
      {source && status === "verified" && (
        <span className="opacity-70">· {t.answerSource[source]}</span>
      )}
    </span>
  );
}

const quizStyles: Record<QuizStatus, string> = {
  draft: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  published: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
  archived: "bg-muted text-muted-foreground border-border",
};

export function QuizStatusBadge({ status }: { status: QuizStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium", quizStyles[status])}>
      {t.quiz.statuses[status]}
    </span>
  );
}
