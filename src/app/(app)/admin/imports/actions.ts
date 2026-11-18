"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { createImportUpload, processImport } from "@/server/imports";
import { aiConfig, getSuggester } from "@/server/ai-providers";
import { requestAiSuggestions, type AiRunResult } from "@/server/ai";
import { fail, type Result } from "@/lib/result";
import { t } from "@/lib/i18n/vi";

export async function createImportUploadAction(input: {
  subjectId: string;
  fileName: string;
  fileSize: number;
}): Promise<Result<{ jobId: string; path: string; token: string }>> {
  const { profile, error } = await authorize("admin");
  if (error) return error;
  return createImportUpload(createAdminClient(), { ...input, userId: profile.id });
}

export async function processImportAction(jobId: string): Promise<Result<{ quizId: string }>> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await processImport(createAdminClient(), jobId);
  revalidatePath("/admin/quizzes");
  if (!res.ok) return res;
  return { ok: true, data: { quizId: res.data.quizId } };
}

export async function requestAiSuggestionsAction(
  quizId: string,
  questionIds: string[],
): Promise<Result<AiRunResult>> {
  const { error } = await authorize("admin");
  if (error) return error;
  const suggester = getSuggester();
  if (!suggester) return fail("VALIDATION", t.ai.disabled);
  const res = await requestAiSuggestions(createAdminClient(), suggester, {
    quizId,
    questionIds,
    batchSize: aiConfig().AI_BATCH_SIZE,
  });
  revalidatePath(`/admin/quizzes/${quizId}`, "layout");
  return res;
}
