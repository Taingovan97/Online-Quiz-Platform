"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/vi";
import { startAttemptAction } from "@/app/(app)/attempts/actions";

export function RetakeButton({ quizId }: { quizId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await startAttemptAction(quizId); // redirects on success
          if (res && !res.ok) toast.error(res.message);
        })
      }
    >
      <RotateCcw /> {t.result.retake}
    </Button>
  );
}
