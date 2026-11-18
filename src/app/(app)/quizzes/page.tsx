import { t } from "@/lib/i18n/vi";

// Placeholder — the quiz library arrives in M2.
export default function QuizzesPage() {
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t.nav.quizzes}</h1>
      <p className="text-muted-foreground">{t.placeholder.quizzes}</p>
    </section>
  );
}
