import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { invitationState } from "@/lib/auth/token";
import { t } from "@/lib/i18n/vi";
import { requireProfile, type Profile } from "@/server/auth";
import { InviteDialog } from "./invite-dialog";
import { ActiveToggle, RevokeButton } from "./row-actions";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

type InvitationRow = {
  id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export default async function UsersPage() {
  const me = await requireProfile("admin");
  const supabase = await createClient();
  const [{ data: users }, { data: invitations }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, role, is_active")
      .order("created_at", { ascending: true })
      .returns<Profile[]>(),
    supabase
      .from("invitations")
      .select("id, email, expires_at, accepted_at, revoked_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<InvitationRow[]>(),
  ]);
  const now = new Date();

  return (
    <section className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.users.title}</h1>
        <InviteDialog />
      </div>

      <div className="grid gap-3">
        <h2 className="text-lg font-medium">{t.users.usersTab}</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.users.name}</TableHead>
                <TableHead>{t.users.email}</TableHead>
                <TableHead>{t.users.role}</TableHead>
                <TableHead className="text-right">{t.users.active}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {t.roles[u.role]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <ActiveToggle
                      userId={u.id}
                      active={u.is_active}
                      disabled={u.id === me.id}
                      label={`${t.users.active}: ${u.full_name}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {(users ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {t.users.noUsers}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="grid gap-3">
        <h2 className="text-lg font-medium">{t.users.invitationsTab}</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.users.email}</TableHead>
                <TableHead>{t.users.expiresAt}</TableHead>
                <TableHead>{t.users.status}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invitations ?? []).map((inv) => {
                const state = invitationState(inv, now);
                return (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>{dateFmt.format(new Date(inv.expires_at))}</TableCell>
                    <TableCell>
                      <Badge variant={state === "open" ? "default" : "outline"}>
                        {t.users.inviteStates[state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {state === "open" && <RevokeButton id={inv.id} />}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(invitations ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {t.users.noInvitations}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
