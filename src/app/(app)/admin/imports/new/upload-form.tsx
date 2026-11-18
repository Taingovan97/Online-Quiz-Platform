"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { createClient } from "@/lib/supabase/browser";
import { t } from "@/lib/i18n/vi";
import { createImportUploadAction, processImportAction } from "../actions";

const MAX_BYTES = 10 * 1024 * 1024;

export function UploadForm({ subjects }: { subjects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "uploading" | "parsing">("idle");
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError(t.imports.badFile);
    if (file.size > MAX_BYTES || !file.name.toLowerCase().endsWith(".pdf")) return setError(t.imports.badFile);

    setStep("uploading");
    const created = await createImportUploadAction({
      subjectId: String(form.get("subjectId")),
      fileName: file.name,
      fileSize: file.size,
    });
    if (!created.ok) {
      setStep("idle");
      return setError(created.message);
    }

    const { error: upErr } = await createClient()
      .storage.from("imports")
      .uploadToSignedUrl(created.data.path, created.data.token, file, { contentType: "application/pdf" });
    if (upErr) {
      setStep("idle");
      return setError(t.imports.notUploaded);
    }

    setStep("parsing");
    const processed = await processImportAction(created.data.jobId);
    if (!processed.ok) {
      setStep("idle");
      return setError(processed.message);
    }
    router.push(`/admin/quizzes/${processed.data.quizId}`);
  }

  const busy = step !== "idle";
  return (
    <form onSubmit={submit} className="grid gap-4">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="subjectId">{t.imports.subject}</Label>
        <NativeSelect id="subjectId" name="subjectId" disabled={busy}>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="file">{t.imports.file}</Label>
        <Input id="file" name="file" type="file" accept="application/pdf,.pdf" required disabled={busy} className="h-auto py-2" />
      </div>
      <Button type="submit" disabled={busy} className="h-10" aria-live="polite">
        <FileUp />
        {step === "uploading" ? t.imports.uploading : step === "parsing" ? t.imports.parsing : t.imports.submit}
      </Button>
    </form>
  );
}
