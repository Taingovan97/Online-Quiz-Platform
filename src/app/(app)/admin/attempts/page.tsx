import { AttemptsTable } from "@/components/attempts-table";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/admin-client";
import { closeExpiredAttempts } from "@/server/exam";
import { listAllAttempts } from "@/server/history";
import { t } from "@/lib/i18n/vi";

export default async function AdminAttemptsPage() {
  await closeExpiredAttempts(createAdminClient(), null);
  const rows = await listAllAttempts(await createClient());
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t.history.allTitle}</h1>
      <AttemptsTable rows={rows} showUser />
    </section>
  );
}
