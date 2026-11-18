import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveProfile } from "@/server/auth";
import { t } from "@/lib/i18n/vi";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getActiveProfile()) redirect("/");
  const { reason } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t.appName}</CardTitle>
          <CardDescription>{t.login.inviteOnly}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm initialError={reason === "inactive" ? t.login.inactive : undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
