"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import {
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  publishQuiz,
  saveQuestion,
  setQuizStatus,
  updateQuizSettings,
  verifyQuestions,
} from "@/server/quizzes";
import type { Result } from "@/lib/result";
import type { AnswerMode, SelectionType, ValidationIssue } from "@/lib/quiz/types";

function refresh(quizId?: string) {
  revalidatePath("/admin/quizzes");
  revalidatePath("/quizzes");
  if (quizId) revalidatePath(`/admin/quizzes/${quizId}`, "layout");
}

export async function createQuizAction(input: { title: string; subjectId: string }): Promise<Result<{ id: string }>> {
  const { profile, error } = await authorize("admin");
  if (error) return error;
  const res = await createQuiz(createAdminClient(), { ...input, createdBy: profile.id });
  if (res.ok) refresh(res.data.id);
  return res;
}

export async function updateQuizSettingsAction(
  quizId: string,
  input: {
    title: string;
    description?: string;
    subjectId: string;
    durationMinutes: number;
    defaultMode: AnswerMode;
  },
  applyModeToQuestions: boolean,
): Promise<Result> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await updateQuizSettings(createAdminClient(), quizId, input, applyModeToQuestions);
  refresh(quizId);
  return res;
}

export async function deleteQuizAction(quizId: string): Promise<Result> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await deleteQuiz(createAdminClient(), quizId);
  if (!res.ok) return res;
  refresh();
  redirect("/admin/quizzes");
}

export async function setQuizStatusAction(
  quizId: string,
  action: "unpublish" | "archive" | "unarchive",
): Promise<Result> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await setQuizStatus(createAdminClient(), quizId, action);
  refresh(quizId);
  return res;
}

export async function publishQuizAction(
  quizId: string,
): Promise<Result<{ published: true; versionNo: number } | { published: false; issues: ValidationIssue[] }>> {
  const { profile, error } = await authorize("admin");
  if (error) return error;
  const res = await publishQuiz(createAdminClient(), quizId, profile.id);
  refresh(quizId);
  return res;
}

export async function saveQuestionAction(
  quizId: string,
  questionId: string | null,
  input: {
    content: string;
    selectionType: SelectionType;
    explanation: string | null;
    options: { content: string; isCorrect: boolean }[];
  },
  verify: boolean,
): Promise<Result<{ id: string }>> {
  const { error } = await authorize("admin");
  if (error) return error;
  const db = createAdminClient();
  const res = await saveQuestion(db, quizId, questionId, input);
  if (res.ok && verify) await verifyQuestions(db, quizId, [res.data.id]);
  refresh(quizId);
  return res;
}

export async function deleteQuestionAction(quizId: string, questionId: string): Promise<Result> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await deleteQuestion(createAdminClient(), quizId, questionId);
  refresh(quizId);
  return res;
}

export async function verifyQuestionsAction(
  quizId: string,
  ids: string[],
): Promise<Result<{ verified: number; skipped: number }>> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await verifyQuestions(createAdminClient(), quizId, ids);
  refresh(quizId);
  return res;
}
