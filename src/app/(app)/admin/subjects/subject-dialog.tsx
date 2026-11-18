"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/confirm-button";
import { t } from "@/lib/i18n/vi";
import { deleteSubjectAction, saveSubjectAction } from "./actions";

type Subject = { id: string; name: string; description: string | null };

export function SubjectDialog({ subject }: { subject?: Subject }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const res = await saveSubjectAction(subject?.id ?? null, {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
      });
      if (res.ok) {
        toast.success(t.subjects.saved);
        setOpen(false);
      } else toast.error(res.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          subject ? (
            <Button variant="ghost" size="icon-lg" aria-label={t.subjects.edit} />
          ) : (
            <Button className="h-10" />
          )
        }
      >
        {subject ? <Pencil /> : <><Plus /> {t.subjects.new}</>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{subject ? t.subjects.edit : t.subjects.new}</DialogTitle>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="subject-name">{t.subjects.name}</Label>
            <Input id="subject-name" name="name" defaultValue={subject?.name} maxLength={120} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="subject-desc">{t.subjects.description}</Label>
            <Textarea id="subject-desc" name="description" defaultValue={subject?.description ?? ""} maxLength={1000} />
          </div>
          <Button type="submit" disabled={pending} className="h-10">
            {pending ? t.common.loading : t.subjects.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SubjectRowActions({ subject }: { subject: Subject }) {
  return (
    <div className="flex gap-1">
      <SubjectDialog subject={subject} />
      <ConfirmButton
        title={t.subjects.confirmDelete(subject.name)}
        confirmLabel={t.subjects.delete}
        onConfirm={async () => {
          const res = await deleteSubjectAction(subject.id);
          if (res.ok) toast.success(t.subjects.deleted);
          else toast.error(res.message);
        }}
        trigger={<Button variant="ghost" size="icon-lg" aria-label={t.subjects.delete} />}
      >
        <Trash2 />
      </ConfirmButton>
    </div>
  );
}
