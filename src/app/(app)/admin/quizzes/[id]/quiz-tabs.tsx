"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/vi";

export function QuizTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/admin/quizzes/${id}`;
  const tabs = [
    { href: base, label: t.quiz.questions },
    { href: `${base}/settings`, label: t.quiz.settings },
    { href: `${base}/preview`, label: t.quiz.preview },
  ];
  return (
    <nav className="flex gap-1 border-b" aria-label={t.quiz.settings}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
