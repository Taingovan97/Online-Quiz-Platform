"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/login/actions";
import { t } from "@/lib/i18n/vi";

export function UserMenu({ nav }: { nav: { href: string; label: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label="Menu" />}>
        <Menu />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {nav.map((item) => (
          <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
            {item.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onClick={() => startTransition(() => signOut())}>
          <LogOut /> {t.nav.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
