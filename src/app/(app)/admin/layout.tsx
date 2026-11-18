import Link from "next/link";
import { requireProfile } from "@/server/auth";
import { t } from "@/lib/i18n/vi";

const links = [
  { href: "/admin", label: t.nav.dashboard },
  { href: "/admin/quizzes", label: t.nav.quizzes },
  { href: "/admin/imports/new", label: t.imports.nav },
  { href: "/admin/subjects", label: t.subjects.title },
  { href: "/admin/users", label: t.nav.users },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireProfile("admin");
  return (
    <div className="grid gap-6">
      <nav className="flex gap-1 overflow-x-auto border-b pb-2" aria-label={t.nav.admin}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="shrink-0 rounded-md px-3 py-1.5 text-sm hover:bg-muted">
            {l.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
