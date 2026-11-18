"use client";

import { useState } from "react";
import { QuestionCard, type CardQuestion } from "@/components/question-card";
import { t } from "@/lib/i18n/vi";

/** Student view of the questions — local state only, nothing is saved. */
export function PreviewList({ questions }: { questions: CardQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  if (questions.length === 0) return <p className="text-muted-foreground">{t.question.empty}</p>;
  return (
    <div className="grid gap-4">
      {questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          mode="preview"
          selected={answers[q.id] ?? []}
          onChange={(labels) => setAnswers((a) => ({ ...a, [q.id]: labels }))}
        />
      ))}
    </div>
  );
}
