import { t } from "@/lib/i18n/vi";

// Placeholder — attempt history arrives in M5.
export default function HistoryPage() {
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t.nav.history}</h1>
      <p className="text-muted-foreground">{t.placeholder.history}</p>
    </section>
  );
}
