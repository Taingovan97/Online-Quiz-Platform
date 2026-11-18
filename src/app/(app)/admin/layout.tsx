import Link from "next/link";
import { requireProfile } from "@/server/auth";
import { t } from "@/lib/i18n/vi";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireProfile("admin");
  return (
    <div className="grid gap-6">
      <nav className="flex gap-1 overflow-x-auto border-b pb-2" aria-label={t.nav.admin}>
        <Link href="/admin" className="rounded-md px-3 py-1.5 text-sm hover:bg-muted">
          {t.nav.dashboard}
        </Link>
        <Link href="/admin/users" className="rounded-md px-3 py-1.5 text-sm hover:bg-muted">
          {t.nav.users}
        </Link>
      </nav>
      {children}
    </div>
  );
}
