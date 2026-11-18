import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fail, ok, type Result } from "@/lib/result";
import { t } from "@/lib/i18n/vi";
import { chunk, validateSuggestions, type AiAnswer, type AiItem } from "@/lib/ai/suggest";
import { contentHash } from "@/lib/quiz/edit";
import { loadQuestions } from "@/server/quizzes";
import type { AnswerSuggester } from "@/server/ai-providers";

export type AiRunResult = {
  applied: number;
  fromCache: number;
  rejected: { questionId: string; reason: string }[];
  failedBatches: number;
};

/**
 * Suggests answers for the selected draft questions only.
 * Cached answers (same content hash + provider + model) are reused without calling the AI.
 * A failing batch changes nothing; other batches still apply.
 */
export async function requestAiSuggestions(
  db: SupabaseClient,
  suggester: AnswerSuggester,
  input: { quizId: string; questionIds: string[]; batchSize: number },
): Promise<Result<AiRunResult>> {
  const parsed = z
    .object({ quizId: z.uuid(), questionIds: z.array(z.uuid()).min(1).max(200) })
    .safeParse(input);
  if (!parsed.success) return fail("VALIDATION", t.errors.validation);

  const { data: quiz } = await db.from("quizzes").select("status").eq("id", input.quizId).maybeSingle();
  if (!quiz) return fail("NOT_FOUND", t.errors.notFound);
  if (quiz.status !== "draft") return fail("CONFLICT", t.quiz.notDraft);

  const wanted = new Set(parsed.data.questionIds);
  const questions = (await loadQuestions(db, input.quizId)).filter((q) => wanted.has(q.id));
  const items = questions.map((q) => ({
    item: {
      ref: q.id,
      stem: q.content,
      selectionType: q.selectionType,
      options: q.options.map((o) => ({ label: o.label, text: o.content })),
    } satisfies AiItem,
    hash: contentHash(q.content, q.options, q.selectionType),
  }));

  // Cache lookup
  const { data: cached } = await db
    .from("ai_suggestions")
    .select("content_hash, suggested_labels, explanation")
    .eq("provider", suggester.provider)
    .eq("model", suggester.model)
    .in("content_hash", [...new Set(items.map((i) => i.hash))]);
  const cache = new Map((cached ?? []).map((c) => [c.content_hash as string, c]));

  const result: AiRunResult = { applied: 0, fromCache: 0, rejected: [], failedBatches: 0 };
  const apply = async (a: AiAnswer) => {
    const { error } = await db.rpc("apply_ai_answer", {
      p_question: a.ref,
      p_labels: a.labels,
      p_explanation: a.explanation,
    });
    if (error) result.rejected.push({ questionId: a.ref, reason: "APPLY_FAILED" });
    return !error;
  };

  const toAsk: typeof items = [];
  for (const entry of items) {
    const hit = cache.get(entry.hash);
    if (!hit) {
      toAsk.push(entry);
      continue;
    }
    // Re-validate cached labels against the current options.
    const { accepted } = validateSuggestions([entry.item], {
      answers: [{ ref: entry.item.ref, labels: hit.suggested_labels, explanation: hit.explanation ?? "", confidence: "medium" }],
    });
    if (accepted.length && (await apply(accepted[0]))) {
      result.applied++;
      result.fromCache++;
    } else toAsk.push(entry);
  }

  for (const batch of chunk(toAsk, input.batchSize)) {
    let raw: unknown;
    try {
      raw = await suggester.suggest(batch.map((b) => b.item));
    } catch {
      result.failedBatches++;
      continue;
    }
    const { accepted, rejected } = validateSuggestions(
      batch.map((b) => b.item),
      raw,
    );
    result.rejected.push(...rejected.map((r) => ({ questionId: r.ref, reason: r.reason })));
    const hashByRef = new Map(batch.map((b) => [b.item.ref, b.hash]));
    if (accepted.length) {
      await db.from("ai_suggestions").upsert(
        accepted.map((a) => ({
          content_hash: hashByRef.get(a.ref)!,
          provider: suggester.provider,
          model: suggester.model,
          suggested_labels: a.labels,
          explanation: a.explanation,
        })),
        { onConflict: "content_hash,provider,model", ignoreDuplicates: true },
      );
    }
    for (const a of accepted) if (await apply(a)) result.applied++;
  }
  return ok(result);
}
