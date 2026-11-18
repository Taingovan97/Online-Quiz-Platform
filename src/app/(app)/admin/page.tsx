import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n/vi";

export default async function AdminDashboard() {
  // Admin RLS policies allow these reads with the user's own session.
  const supabase = await createClient();
  const [users, invites] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);

  const stats = [
    { label: t.dashboard.users, value: users.count ?? 0 },
    { label: t.dashboard.openInvitations, value: invites.count ?? 0 },
  ];

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t.dashboard.title}</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{s.value}</CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
