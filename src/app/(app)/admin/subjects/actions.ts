"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { deleteSubject, saveSubject } from "@/server/quizzes";
import type { Result } from "@/lib/result";

export async function saveSubjectAction(
  id: string | null,
  input: { name: string; description?: string },
): Promise<Result<{ id: string }>> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await saveSubject(createAdminClient(), id, input);
  revalidatePath("/admin/subjects");
  return res;
}

export async function deleteSubjectAction(id: string): Promise<Result> {
  const { error } = await authorize("admin");
  if (error) return error;
  const res = await deleteSubject(createAdminClient(), id);
  revalidatePath("/admin/subjects");
  return res;
}
