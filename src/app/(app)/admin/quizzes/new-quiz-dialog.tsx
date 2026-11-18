"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { t } from "@/lib/i18n/vi";
import { createQuizAction } from "./actions";

export function NewQuizDialog({ subjects }: { subjects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await createQuizAction({
        title: String(formData.get("title") ?? ""),
        subjectId: String(formData.get("subjectId") ?? ""),
      });
      if (res.ok) {
        setOpen(false);
        router.push(`/admin/quizzes/${res.data.id}`);
      } else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="h-10" />}>
        <Plus /> {t.quiz.new}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.quiz.new}</DialogTitle>
        </DialogHeader>
        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.subjects.empty}</p>
        ) : (
          <form action={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="quiz-title">{t.quiz.title}</Label>
              <Input id="quiz-title" name="title" maxLength={200} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quiz-subject">{t.quiz.subject}</Label>
              <NativeSelect id="quiz-subject" name="subjectId" required>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" disabled={pending} className="h-10">
              {pending ? t.common.loading : t.quiz.new}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
