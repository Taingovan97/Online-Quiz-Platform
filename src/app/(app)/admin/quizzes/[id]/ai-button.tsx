"use client";

import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { t } from "@/lib/i18n/vi";
import { requestAiSuggestionsAction } from "../../imports/actions";

/** Shows the number of questions before any paid request, then asks the AI for just those. */
export function AiButton({
  quizId,
  model,
  questionIds,
  onDone,
}: {
  quizId: string;
  model: string;
  questionIds: string[];
  onDone: () => void;
}) {
  const n = questionIds.length;
  if (n === 0) {
    return (
      <Button variant="outline" disabled title={t.ai.selectHint}>
        <Sparkles /> {t.ai.ask(0)}
      </Button>
    );
  }
  return (
    <ConfirmButton
      title={t.ai.confirmTitle}
      description={t.ai.confirmBody(n, model)}
      confirmLabel={t.ai.confirm}
      destructive={false}
      trigger={<Button variant="outline" />}
      onConfirm={async () => {
        const res = await requestAiSuggestionsAction(quizId, questionIds);
        if (!res.ok) return void toast.error(res.message);
        const r = res.data;
        if (r.failedBatches && !r.applied) toast.error(t.ai.failed);
        else toast.success(t.ai.result(r.applied, r.fromCache, r.rejected.length, r.failedBatches));
        onDone();
      }}
    >
      <Sparkles /> {t.ai.ask(n)}
    </ConfirmButton>
  );
}
