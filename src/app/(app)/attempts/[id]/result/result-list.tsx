"use client";

import { useState } from "react";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuestionCard, type CardQuestion } from "@/components/question-card";
import { t } from "@/lib/i18n/vi";
import type { QuestionResult } from "@/lib/grading/grade";

type Item = {
  question: CardQuestion;
  correct: string[];
  explanation: string | null;
  selected: string[];
  result: QuestionResult;
};
type Filter = "all" | "wrong" | "unanswered";

const icon = {
  correct: <CircleCheck className="size-4 text-green-600" aria-label={t.result.correct} />,
  incorrect: <CircleX className="size-4 text-red-600" aria-label={t.result.incorrect} />,
  unanswered: <CircleDashed className="size-4 text-muted-foreground" aria-label={t.result.unanswered} />,
};

export function ResultList({ items, initialFilter }: { items: Item[]; initialFilter: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const visible = items.filter((i) =>
    filter === "all" ? true : filter === "wrong" ? i.result === "incorrect" : i.result === "unanswered",
  );
  return (
    <div className="grid gap-4">
      <div className="flex gap-1 rounded-lg border p-1 w-fit" role="group" aria-label="Lọc">
        {(["all", "wrong", "unanswered"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t.result.filters[f]}
          </Button>
        ))}
      </div>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">{t.result.nothingHere}</p>}
      {visible.map((i) => (
        <QuestionCard
          key={i.question.id}
          question={i.question}
          mode="result"
          selected={i.selected}
          correct={i.correct}
          explanation={i.explanation}
          headerExtra={<span className="ml-1">{icon[i.result]}</span>}
        />
      ))}
    </div>
  );
}
