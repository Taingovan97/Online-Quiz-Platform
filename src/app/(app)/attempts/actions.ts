"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { saveAnswer, startAttempt, submitAttempt } from "@/server/exam";
import type { Result } from "@/lib/result";

export async function startAttemptAction(quizId: string): Promise<Result> {
  const { profile, error } = await authorize();
  if (error) return error;
  const res = await startAttempt(createAdminClient(), profile.id, quizId);
  if (!res.ok) return res;
  redirect(`/attempts/${res.data.attemptId}`);
}

export async function saveAnswerAction(
  attemptId: string,
  questionId: string,
  labels: string[],
): Promise<Result<{ savedAt: string }>> {
  const { profile, error } = await authorize();
  if (error) return error;
  return saveAnswer(createAdminClient(), profile.id, { attemptId, questionId, labels });
}

export async function submitAttemptAction(attemptId: string, reason: "manual" | "timeout"): Promise<Result<{ attemptId: string }>> {
  const { profile, error } = await authorize();
  if (error) return error;
  const res = await submitAttempt(createAdminClient(), profile.id, attemptId, reason);
  revalidatePath("/history");
  return res;
}
