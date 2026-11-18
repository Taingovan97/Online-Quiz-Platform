"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/i18n/vi";
import { revokeInvitationAction, setUserActiveAction } from "./actions";

export function ActiveToggle({
  userId,
  active,
  disabled,
  label,
}: {
  userId: string;
  active: boolean;
  disabled?: boolean;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      checked={active}
      disabled={disabled || pending}
      aria-label={label}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const res = await setUserActiveAction(userId, next);
          if (res.ok) toast.success(next ? t.users.activated : t.users.deactivated);
          else toast.error(res.message);
        })
      }
    />
  );
}

export function RevokeButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await revokeInvitationAction(id);
          if (res.ok) toast.success(t.users.revoked);
          else toast.error(res.message);
        })
      }
    >
      {t.users.revoke}
    </Button>
  );
}
