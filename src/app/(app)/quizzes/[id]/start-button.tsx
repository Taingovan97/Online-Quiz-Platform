"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { t } from "@/lib/i18n/vi";
import { startAttemptAction } from "@/app/(app)/attempts/actions";

export function StartButton({
  quizId,
  minutes,
  activeAttemptId,
}: {
  quizId: string;
  minutes: number;
  activeAttemptId?: string;
}) {
  if (activeAttemptId) {
    return (
      <Button className="h-11 w-full sm:w-fit" render={<Link href={`/attempts/${activeAttemptId}`} />} nativeButton={false}>
        {t.exam.continue}
      </Button>
    );
  }
  return (
    <ConfirmButton
      title={t.exam.startConfirmTitle}
      description={t.exam.startConfirm(minutes)}
      confirmLabel={t.exam.start}
      destructive={false}
      trigger={<Button className="h-11 w-full sm:w-fit" />}
      onConfirm={async () => {
        const res = await startAttemptAction(quizId); // redirects on success
        if (res && !res.ok) toast.error(res.message);
      }}
    >
      {t.quiz.start}
    </ConfirmButton>
  );
}
