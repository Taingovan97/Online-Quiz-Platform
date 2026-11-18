import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fail, ok, type Result } from "@/lib/result";
import { t } from "@/lib/i18n/vi";
import { contentHash } from "@/lib/quiz/edit";
import type { AnswerMode } from "@/lib/quiz/types";
import { extractItems } from "@/lib/pdf-import/extract";
import { parsePdfItems } from "@/lib/pdf-import/parse";
import type { ImportSummary, ParseWarning, ParsedQuiz } from "@/lib/pdf-import/types";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const IMPORT_BUCKET = "imports";

const uploadSchema = z.object({
  subjectId: z.uuid(),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((n) => n.toLowerCase().endsWith(".pdf")),
  fileSize: z.number().int().min(1).max(MAX_PDF_BYTES),
});

/** Registers an import job and returns a one-time signed URL to upload the PDF straight to Storage. */
export async function createImportUpload(
  db: SupabaseClient,
  input: z.input<typeof uploadSchema> & { userId: string },
): Promise<Result<{ jobId: string; path: string; token: string }>> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", t.imports.badFile);

  const jobId = crypto.randomUUID();
  const path = `${jobId}.pdf`;
  const { error } = await db.from("import_jobs").insert({
    id: jobId,
    subject_id: parsed.data.subjectId,
    storage_path: path,
    file_name: parsed.data.fileName,
    file_size: parsed.data.fileSize,
    created_by: input.userId,
  });
  if (error) return fail("INTERNAL", t.errors.internal);

  const { data, error: signErr } = await db.storage.from(IMPORT_BUCKET).createSignedUploadUrl(path);
  if (signErr || !data) return fail("INTERNAL", t.errors.internal);
  return ok({ jobId, path, token: data.token });
}

/** Turns parser output into the rows create_imported_quiz() expects. */
export function toImportRows(parsed: ParsedQuiz) {
  return parsed.questions.map((q) => {
    const valid = q.status === "extracted_valid";
    return {
      source_number: q.number,
      content: q.stem,
      selection_type: q.selectionType,
      explanation: q.explanation,
      answer_status: q.status,
      answer_source: valid ? "pdf_extracted" : null,
      original_answer: q.answer,
      content_hash: contentHash(q.stem, q.options, q.selectionType),
      options: q.options.map((o) => ({
        label: o.label,
        content: o.content,
        is_correct: valid && (q.answer ?? []).includes(o.label),
      })),
    };
  });
}

function quizMode(parsed: ParsedQuiz): AnswerMode {
  const types = new Set(parsed.questions.map((q) => q.selectionType));
  return types.size > 1 ? "mixed" : types.has("multiple") ? "multiple" : "single";
}

/** Validates, extracts and parses an uploaded PDF, then creates the draft quiz. */
export async function processImport(
  db: SupabaseClient,
  jobId: string,
): Promise<Result<{ quizId: string; summary: ImportSummary; warnings: ParseWarning[] }>> {
  if (!z.uuid().safeParse(jobId).success) return fail("VALIDATION", t.errors.validation);

  // Claim the job (uploaded/failed → processing) so it is processed only once at a time.
  const { data: claimed } = await db
    .from("import_jobs")
    .update({ status: "processing", error: null })
    .eq("id", jobId)
    .in("status", ["uploaded", "failed"])
    .select("id, storage_path, file_name")
    .maybeSingle<{ id: string; storage_path: string; file_name: string }>();
  if (!claimed) return fail("CONFLICT", t.imports.alreadyProcessed);

  const failJob = async (message: string) => {
    await db.from("import_jobs").update({ status: "failed", error: message }).eq("id", jobId);
    return fail("VALIDATION", message);
  };

  const { data: blob, error: dlErr } = await db.storage.from(IMPORT_BUCKET).download(claimed.storage_path);
  if (dlErr || !blob) return failJob(t.imports.notUploaded);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES) return failJob(t.imports.badFile);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return failJob(t.imports.notPdf);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: dupes } = await db
    .from("import_jobs")
    .select("id")
    .eq("file_sha256", sha256)
    .eq("status", "parsed")
    .neq("id", jobId)
    .limit(1);
  await db.from("import_jobs").update({ file_sha256: sha256, file_size: bytes.byteLength }).eq("id", jobId);

  let parsed: ParsedQuiz;
  try {
    // PDF content is untrusted: only text is extracted, nothing is executed or rendered.
    const items = await extractItems(bytes);
    if (items.length === 0) return failJob(t.imports.noText);
    parsed = parsePdfItems(items);
  } catch {
    return failJob(t.imports.unreadable);
  }
  if (parsed.questions.length === 0) return failJob(t.imports.noQuestions);

  const warnings: ParseWarning[] = [...parsed.warnings];
  if (dupes?.length) warnings.unshift({ code: "DUPLICATE_FILE", detail: t.imports.duplicateFile });

  const title = parsed.title ?? claimed.file_name.replace(/\.pdf$/i, "");
  const { data: quizId, error } = await db.rpc("create_imported_quiz", {
    p_job: jobId,
    p_title: title.slice(0, 200),
    p_mode: quizMode(parsed),
    p_questions: toImportRows(parsed),
    p_summary: parsed.summary,
    p_warnings: warnings,
  });
  if (error || !quizId) return failJob(t.errors.internal);
  return ok({ quizId: quizId as string, summary: parsed.summary, warnings });
}
