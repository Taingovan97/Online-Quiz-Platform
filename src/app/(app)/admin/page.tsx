import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { aiConfig } from "@/server/ai-providers";
import { isoDaysAgo } from "@/lib/dates";
import { t } from "@/lib/i18n/vi";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export default async function AdminDashboard() {
  // Admin RLS policies allow these reads with the user's own session.
  const supabase = await createClient();
  const weekAgo = isoDaysAgo(7);
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [users, published, drafts, attempts, invites, { data: imports }] = await Promise.all([
    count(supabase.from("profiles").select("id", { count: "exact", head: true })),
    count(supabase.from("quizzes").select("id", { count: "exact", head: true }).eq("status", "published")),
    count(supabase.from("quizzes").select("id", { count: "exact", head: true }).eq("status", "draft")),
    count(supabase.from("attempts").select("id", { count: "exact", head: true }).gte("started_at", weekAgo)),
    count(
      supabase
        .from("invitations")
        .select("id", { count: "exact", head: true })
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString()),
    ),
    supabase
      .from("import_jobs")
      .select("id, file_name, status, created_at, quiz_id, summary")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const stats = [
    { label: t.dashboard.users, value: users, href: "/admin/users" },
    { label: t.dashboard.published, value: published, href: "/admin/quizzes?status=published" },
    { label: t.dashboard.drafts, value: drafts, href: "/admin/quizzes?status=draft" },
    { label: t.dashboard.attempts7d, value: attempts, href: "/admin/attempts" },
    { label: t.dashboard.openInvitations, value: invites, href: "/admin/users" },
  ];
  const ai = aiConfig();

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t.dashboard.title}</h1>
        <span className="text-sm text-muted-foreground">{ai.enabled ? `${t.ai.enabled} (${ai.model})` : t.ai.off}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="h-full transition-colors hover:bg-muted">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold">{s.value}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <div className="grid gap-2">
        <h2 className="text-lg font-medium">{t.dashboard.recentImports}</h2>
        {(imports ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.dashboard.noImports}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {imports!.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="font-medium">{j.file_name}</span>
                <span className="text-muted-foreground">{dateFmt.format(new Date(j.created_at))}</span>
                <span className="text-muted-foreground">{t.dashboard.importStatus[j.status as keyof typeof t.dashboard.importStatus]}</span>
                {j.quiz_id && (
                  <Link href={`/admin/quizzes/${j.quiz_id}`} className="ml-auto underline">
                    {t.dashboard.review}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
