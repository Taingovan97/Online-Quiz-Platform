"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/native-select";
import { ConfirmButton } from "@/components/confirm-button";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/vi";
import type { AnswerMode, QuizStatus } from "@/lib/quiz/types";
import { deleteQuizAction, setQuizStatusAction, updateQuizSettingsAction } from "../../actions";

type Quiz = {
  id: string;
  title: string;
  description: string | null;
  subject_id: string;
  duration_minutes: number;
  default_mode: AnswerMode;
  status: QuizStatus;
};

export function SettingsForm({ quiz, subjects }: { quiz: Quiz; subjects: { id: string; name: string }[] }) {
  const editable = quiz.status === "draft";
  const [mode, setMode] = useState<AnswerMode>(quiz.default_mode);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await updateQuizSettingsAction(
        quiz.id,
        {
          title: String(formData.get("title") ?? ""),
          description: String(formData.get("description") ?? ""),
          subjectId: String(formData.get("subjectId") ?? ""),
          durationMinutes: Number(formData.get("durationMinutes")),
          defaultMode: mode,
        },
        formData.get("applyMode") === "on",
      );
      if (res.ok) toast.success(t.quiz.saved);
      else toast.error(res.message);
    });
  }

  return (
    <form action={submit} className="grid gap-5">
      <fieldset disabled={!editable || pending} className="grid gap-5">
        {!editable && <p className="text-sm text-muted-foreground">{t.quiz.lockedNotice}</p>}
        <div className="grid gap-2">
          <Label htmlFor="title">{t.quiz.title}</Label>
          <Input id="title" name="title" defaultValue={quiz.title} maxLength={200} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">{t.quiz.description}</Label>
          <Textarea id="description" name="description" defaultValue={quiz.description ?? ""} maxLength={2000} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="subjectId">{t.quiz.subject}</Label>
            <NativeSelect id="subjectId" name="subjectId" defaultValue={quiz.subject_id}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="durationMinutes">{t.quiz.duration}</Label>
            <Input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={1}
              max={300}
              defaultValue={quiz.duration_minutes}
              required
            />
          </div>
        </div>

        <div className="grid gap-2" role="radiogroup" aria-label={t.quiz.mode}>
          <span className="text-sm font-medium">{t.quiz.mode}</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["single", "multiple", "mixed"] as const).map((m) => (
              <label
                key={m}
                className={cn(
                  "grid cursor-pointer gap-1 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-muted",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                  {t.quiz.modes[m]}
                </span>
                <span className="text-muted-foreground">{t.quiz.modeHelp[m]}</span>
              </label>
            ))}
          </div>
          {mode !== "mixed" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="applyMode" className="size-4" />
              {t.quiz.applyMode}
            </label>
          )}
        </div>

        <Button type="submit" className="h-10 w-fit">
          {pending ? t.common.loading : t.subjects.save}
        </Button>
      </fieldset>
    </form>
  );
}

export function StatusActions({
  quizId,
  status,
  hasVersions,
}: {
  quizId: string;
  status: QuizStatus;
  hasVersions: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const run = (action: "unpublish" | "archive" | "unarchive") =>
    startTransition(async () => {
      const res = await setQuizStatusAction(quizId, action);
      if (!res.ok) toast.error(res.message);
    });

  return (
    <div className="grid gap-2">
      <h2 className="font-medium">{t.quiz.status}</h2>
      <div className="flex flex-wrap gap-2">
        {status === "published" && (
          <>
            <Button variant="outline" disabled={pending} onClick={() => run("unpublish")}>
              {t.quiz.unpublish}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => run("archive")}>
              {t.quiz.archive}
            </Button>
          </>
        )}
        {status === "archived" && (
          <Button variant="outline" disabled={pending} onClick={() => run("unarchive")}>
            {t.quiz.unarchive}
          </Button>
        )}
        {status === "draft" && !hasVersions && (
          <ConfirmButton
            title={t.quiz.confirmDelete}
            confirmLabel={t.quiz.delete}
            trigger={<Button variant="destructive" />}
            onConfirm={async () => {
              const res = await deleteQuizAction(quizId);
              if (res && !res.ok) toast.error(res.message);
            }}
          >
            {t.quiz.delete}
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}
