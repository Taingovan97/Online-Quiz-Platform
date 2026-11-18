import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/server/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireProfile();
  return <AppShell profile={profile}>{children}</AppShell>;
}
