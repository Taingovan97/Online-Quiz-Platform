"use client";

import { useState, useTransition } from "react";
import { Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/vi";
import { createInvitationAction } from "./actions";

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ link: string; ttlHours: number }>();
  const [pending, startTransition] = useTransition();

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setEmail("");
      setError(undefined);
      setResult(undefined);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const res = await createInvitationAction(email);
      if (res.ok) setResult({ link: res.data.link, ttlHours: res.data.ttlHours });
      else setError(res.message);
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      toast.success(t.users.copied);
    } catch {
      toast.error(t.errors.internal);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button className="h-10" />}>
        <UserPlus /> {t.users.invite}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.users.inviteDialogTitle}</DialogTitle>
          <DialogDescription>{t.users.inviteDialogDesc}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Input readOnly value={result.link} aria-label="Liên kết mời" onFocus={(e) => e.target.select()} />
              <Button onClick={copy} aria-label={t.users.copy}>
                <Copy /> {t.users.copy}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t.users.expiresIn(result.ttlHours)}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="invite-email">{t.users.email}</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending} className="h-10">
              {pending ? t.common.loading : t.users.create}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
