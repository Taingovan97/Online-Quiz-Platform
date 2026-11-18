import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createAdminClient } from "@/server/admin-client";
import { findOpenInvitation } from "@/server/invitations";
import { t } from "@/lib/i18n/vi";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = token.length <= 200 ? await findOpenInvitation(createAdminClient(), token) : null;

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t.invite.title}</CardTitle>
          {invitation && <CardDescription>{t.invite.subtitle}</CardDescription>}
        </CardHeader>
        <CardContent>
          {invitation ? (
            <AcceptForm token={token} email={invitation.email} />
          ) : (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t.invite.invalid}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
