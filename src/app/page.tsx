import { redirect } from "next/navigation";
import { requireProfile } from "@/server/auth";

export default async function Home() {
  const profile = await requireProfile();
  redirect(profile.role === "admin" ? "/admin" : "/quizzes");
}
