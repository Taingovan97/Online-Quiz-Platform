"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/vi";
import { acceptInvite, type AcceptState } from "./actions";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvite, {});

  return (
    <form action={action} className="grid gap-4">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-2">
        <Label htmlFor="email">{t.login.email}</Label>
        <Input id="email" value={email} readOnly disabled />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="fullName">{t.invite.fullName}</Label>
        <Input id="fullName" name="fullName" autoComplete="name" maxLength={100} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">{t.invite.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">{t.invite.confirmPassword}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
      </div>
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? t.common.loading : t.invite.submit}
      </Button>
    </form>
  );
}
