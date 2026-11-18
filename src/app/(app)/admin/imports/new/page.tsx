import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n/vi";
import { UploadForm } from "./upload-form";

export default async function NewImportPage() {
  const supabase = await createClient();
  const { data: subjects } = await supabase.from("subjects").select("id, name").order("name");
  return (
    <section className="mx-auto grid w-full max-w-xl gap-4">
      <h1 className="text-2xl font-semibold">{t.imports.title}</h1>
      <p className="text-sm text-muted-foreground">{t.imports.help}</p>
      {(subjects ?? []).length === 0 ? (
        <p className="text-muted-foreground">{t.subjects.empty}</p>
      ) : (
        <UploadForm subjects={subjects ?? []} />
      )}
    </section>
  );
}
