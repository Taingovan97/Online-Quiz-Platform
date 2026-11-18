import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { getExamPaper } from "@/server/exam";
import { ExamClient } from "./exam-client";

/** Exam screen: full-height, no app navigation (ui-ux-design §3). */
export default async function ExamPage({ params }: PageProps<"/attempts/[id]">) {
  const { id } = await params;
  const profile = await requireProfile();
  const res = await getExamPaper(createAdminClient(), profile.id, id);
  if (!res.ok) notFound();
  if ("submitted" in res.data) redirect(`/attempts/${id}/result`);
  return <ExamClient {...res.data} />;
}
