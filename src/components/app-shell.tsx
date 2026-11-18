import Link from "next/link";
import { UserMenu } from "@/components/user-menu";
import { t } from "@/lib/i18n/vi";
import type { Profile } from "@/server/auth";

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const nav = [
    { href: "/quizzes", label: t.nav.quizzes },
    { href: "/history", label: t.nav.history },
    ...(profile.role === "admin" ? [{ href: "/admin", label: t.nav.admin }] : []),
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="font-semibold">
            {t.appName}
          </Link>
          <nav className="hidden gap-1 sm:flex" aria-label="Điều hướng chính">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {profile.full_name}
            </span>
            <UserMenu nav={nav} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
