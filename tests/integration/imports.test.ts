import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createImportUpload, processImport } from "@/server/imports";
import { requestAiSuggestions } from "@/server/ai";
import type { AnswerSuggester } from "@/server/ai-providers";
import type { AiItem } from "@/lib/ai/suggest";
import { createQuiz, loadQuestions, publishQuiz, saveQuestion, saveSubject, verifyQuestions } from "@/server/quizzes";
import { adminDb, anonDb, createUser, resetDb, signInAs } from "./helpers";

const PDF = new Uint8Array(readFileSync("tests/fixtures/pdf/PLDC1.pdf"));
const KEY = "B D D D A B C A B B B B A B A A D D A B A C B B C D B C D C A A A C A B B B A A C C".split(" ");

let adminId: string;
let subjectId: string;

async function upload(bytes: Uint8Array, fileName = "PLDC1.pdf") {
  const res = await createImportUpload(adminDb(), { subjectId, fileName, fileSize: bytes.byteLength, userId: adminId });
  if (!res.ok) throw new Error(res.message);
  // Same call the browser makes: token-based upload, no admin key involved.
  const { error } = await anonDb()
    .storage.from("imports")
    .uploadToSignedUrl(res.data.path, res.data.token, new Blob([bytes as BlobPart], { type: "application/pdf" }), {
      contentType: "application/pdf",
    });
  if (error) throw error;
  return res.data.jobId;
}

async function clearStorage() {
  const db = adminDb();
  const { data } = await db.storage.from("imports").list("", { limit: 1000 });
  if (data?.length) await db.storage.from("imports").remove(data.map((f) => f.name));
}

beforeEach(async () => {
  await resetDb();
  await clearStorage();
  adminId = await createUser("admin@test.local", "admin");
  await createUser("student@test.local", "student");
  const s = await saveSubject(adminDb(), null, { name: "Pháp luật đại cương" });
  if (!s.ok) throw new Error(s.message);
  subjectId = s.data.id;
});

describe("PDF import", () => {
  it("imports PLDC1 into a draft quiz with every answer from the PDF key", async () => {
    const jobId = await upload(PDF);
    const res = await processImport(adminDb(), jobId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.summary).toEqual({ total: 42, extractedValid: 42, missing: 0, invalid: 0, ambiguous: 0, keyFound: true });

    const { data: quiz } = await adminDb().from("quizzes").select("title, status, default_mode").eq("id", res.data.quizId).single();
    expect(quiz).toEqual({ title: "Pháp luật đại cương 01", status: "draft", default_mode: "single" });

    const qs = await loadQuestions(adminDb(), res.data.quizId);
    expect(qs).toHaveLength(42);
    expect(qs.flatMap((q) => q.options)).toHaveLength(168);
    expect(qs.map((q) => q.options.filter((o) => o.isCorrect).map((o) => o.label).join(""))).toEqual(KEY);
    expect(qs.every((q) => q.answerStatus === "extracted_valid" && q.answerSource === "pdf_extracted")).toBe(true);
    expect(qs.map((q) => q.originalAnswer?.join(""))).toEqual(KEY);

    const { data: job } = await adminDb().from("import_jobs").select("status, file_sha256, quiz_id").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "parsed", quiz_id: res.data.quizId });
    expect(job!.file_sha256).toMatch(/^[0-9a-f]{64}$/);

    // Straight to publish: PDF-extracted answers count as resolved.
    expect(await publishQuiz(adminDb(), res.data.quizId, adminId)).toEqual({ ok: true, data: { published: true, versionNo: 1 } });
  });

  it("warns about duplicate files and refuses to process a job twice", async () => {
    const first = await upload(PDF);
    await processImport(adminDb(), first);
    expect(await processImport(adminDb(), first)).toMatchObject({ ok: false, code: "CONFLICT" });

    const second = await upload(PDF, "copy.pdf");
    const res = await processImport(adminDb(), second);
    expect(res.ok && res.data.warnings[0].code).toBe("DUPLICATE_FILE");
  });

  it("rejects files that are not PDFs without creating a quiz", async () => {
    const jobId = await upload(new TextEncoder().encode("not a pdf at all"), "fake.pdf");
    expect(await processImport(adminDb(), jobId)).toMatchObject({ ok: false, code: "VALIDATION" });
    const { data } = await adminDb().from("import_jobs").select("status, quiz_id, error").eq("id", jobId).single();
    expect(data).toMatchObject({ status: "failed", quiz_id: null });
    const { count } = await adminDb().from("quizzes").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("validates upload metadata", async () => {
    for (const bad of [
      { fileName: "x.docx", fileSize: 100 },
      { fileName: "big.pdf", fileSize: 11 * 1024 * 1024 },
    ]) {
      expect(await createImportUpload(adminDb(), { subjectId, ...bad, userId: adminId })).toMatchObject({ ok: false, code: "VALIDATION" });
    }
  });

  it("students cannot see import jobs or uploaded files, or upload directly", async () => {
    await processImport(adminDb(), await upload(PDF));
    const db = await signInAs("student@test.local");
    expect((await db.from("import_jobs").select("id")).data ?? []).toEqual([]);
    expect((await db.storage.from("imports").list("")).data ?? []).toEqual([]);
    const { error } = await db.storage.from("imports").upload("evil.pdf", new Blob(["%PDF-"]), { contentType: "application/pdf" });
    expect(error).not.toBeNull();
  });
});

describe("AI fallback", () => {
  let quizId: string;
  let ids: string[];

  function mockSuggester(answer: (item: AiItem) => string[] | null, opts: { fail?: boolean } = {}) {
    const calls: AiItem[][] = [];
    const s: AnswerSuggester & { calls: AiItem[][] } = {
      provider: "mock",
      model: "mock-1",
      calls,
      async suggest(items) {
        calls.push(items);
        if (opts.fail) throw new Error("boom");
        return {
          answers: items
            .map((i) => ({ i, labels: answer(i) }))
            .filter((x) => x.labels)
            .map(({ i, labels }) => ({ ref: i.ref, labels, explanation: `AI giải thích ${i.stem}`, confidence: "high" })),
        };
      },
    };
    return s;
  }

  beforeEach(async () => {
    const q = await createQuiz(adminDb(), { title: "Đề AI", subjectId, createdBy: adminId });
    if (!q.ok) throw new Error(q.message);
    quizId = q.data.id;
    ids = [];
    for (const [i, correct] of [[], [], ["A"]].entries()) {
      const r = await saveQuestion(adminDb(), quizId, null, {
        content: `Câu ${i + 1}`,
        selectionType: "single",
        explanation: null,
        options: ["A", "B", "C", "D"].map((l) => ({ content: `PA ${l} ${i}`, isCorrect: correct.includes(l) })),
      });
      if (!r.ok) throw new Error(r.message);
      ids.push(r.data.id);
    }
  });

  it("sends only the selected questions, marks answers as AI suggestions, caches them", async () => {
    const ai = mockSuggester(() => ["C"]);
    const res = await requestAiSuggestions(adminDb(), ai, { quizId, questionIds: ids.slice(0, 2), batchSize: 20 });
    expect(res).toEqual({ ok: true, data: { applied: 2, fromCache: 0, rejected: [], failedBatches: 0 } });
    expect(ai.calls.flat().map((i) => i.ref)).toEqual(ids.slice(0, 2));

    const qs = await loadQuestions(adminDb(), quizId);
    expect(qs[0]).toMatchObject({ answerStatus: "ai_suggested", answerSource: "ai_generated", explanation: "AI giải thích Câu 1" });
    expect(qs[0].options.find((o) => o.isCorrect)?.label).toBe("C");
    expect(qs[2]).toMatchObject({ answerStatus: "verified" }); // untouched

    // Publishing stays blocked until a human confirms.
    const blocked = await publishQuiz(adminDb(), quizId, adminId);
    expect(blocked.ok && !blocked.data.published && blocked.data.issues.map((i) => i.code)).toEqual(["UNVERIFIED", "UNVERIFIED"]);

    // Same content again → served from cache, no AI call.
    const again = await requestAiSuggestions(adminDb(), ai, { quizId, questionIds: ids.slice(0, 2), batchSize: 20 });
    expect(again.ok && again.data).toMatchObject({ applied: 2, fromCache: 2 });
    expect(ai.calls).toHaveLength(1);

    await verifyQuestions(adminDb(), quizId, ids);
    expect((await publishQuiz(adminDb(), quizId, adminId)).ok).toBe(true);
  });

  it("batches requests", async () => {
    const ai = mockSuggester(() => ["B"]);
    await requestAiSuggestions(adminDb(), ai, { quizId, questionIds: ids, batchSize: 2 });
    expect(ai.calls.map((c) => c.length)).toEqual([2, 1]);
  });

  it("a failing provider changes nothing", async () => {
    const before = await loadQuestions(adminDb(), quizId);
    const res = await requestAiSuggestions(adminDb(), mockSuggester(() => ["A"], { fail: true }), { quizId, questionIds: ids, batchSize: 20 });
    expect(res).toEqual({ ok: true, data: { applied: 0, fromCache: 0, rejected: [], failedBatches: 1 } });
    expect(await loadQuestions(adminDb(), quizId)).toEqual(before);
  });

  it("invalid suggestions are rejected and not applied or cached", async () => {
    const res = await requestAiSuggestions(adminDb(), mockSuggester(() => ["Z"]), { quizId, questionIds: ids.slice(0, 1), batchSize: 20 });
    expect(res.ok && res.data.rejected).toEqual([{ questionId: ids[0], reason: "UNKNOWN_LABEL" }]);
    expect((await loadQuestions(adminDb(), quizId))[0].answerStatus).toBe("missing");
    const { count } = await adminDb().from("ai_suggestions").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("keeps the original PDF answer when AI changes the current one", async () => {
    await adminDb().from("questions").update({ original_answer: ["A"] }).eq("id", ids[2]);
    await requestAiSuggestions(adminDb(), mockSuggester(() => ["D"]), { quizId, questionIds: [ids[2]], batchSize: 20 });
    const q = (await loadQuestions(adminDb(), quizId))[2];
    expect(q).toMatchObject({ originalAnswer: ["A"], answerSource: "ai_generated" });
    expect(q.options.find((o) => o.isCorrect)?.label).toBe("D");
  });
});
