import { AttemptsTable } from "@/components/attempts-table";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/server/auth";
import { createAdminClient } from "@/server/admin-client";
import { closeExpiredAttempts } from "@/server/exam";
import { listAttempts } from "@/server/history";
import { t } from "@/lib/i18n/vi";

export default async function HistoryPage() {
  const profile = await requireProfile();
  await closeExpiredAttempts(createAdminClient(), profile.id);
  const rows = await listAttempts(await createClient(), profile.id);
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t.nav.history}</h1>
      <AttemptsTable rows={rows} />
    </section>
  );
}
