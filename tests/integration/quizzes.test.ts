import { beforeEach, describe, expect, it } from "vitest";
import {
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  deleteSubject,
  loadQuestions,
  publishQuiz,
  saveQuestion,
  saveSubject,
  setQuizStatus,
  updateQuizSettings,
  verifyQuestions,
} from "@/server/quizzes";
import { adminDb, createUser, resetDb, signInAs } from "./helpers";

let adminId: string;
let subjectId: string;
let quizId: string;

const opts = (correct: string[]) =>
  ["A", "B", "C", "D"].map((l) => ({ content: `Phương án ${l}`, isCorrect: correct.includes(l) }));

async function addQuestion(content: string, correct: string[], selectionType: "single" | "multiple" = "single") {
  const res = await saveQuestion(adminDb(), quizId, null, {
    content,
    selectionType,
    explanation: `Giải thích ${content}`,
    options: opts(correct),
  });
  if (!res.ok) throw new Error(res.message);
  return res.data.id;
}

beforeEach(async () => {
  await resetDb();
  adminId = await createUser("admin@test.local", "admin");
  await createUser("student@test.local", "student");
  const s = await saveSubject(adminDb(), null, { name: "Pháp luật đại cương" });
  if (!s.ok) throw new Error(s.message);
  subjectId = s.data.id;
  const q = await createQuiz(adminDb(), { title: "Đề 01", subjectId, createdBy: adminId });
  if (!q.ok) throw new Error(q.message);
  quizId = q.data.id;
});

describe("question editing", () => {
  it("stores options A–D and appends positions", async () => {
    await addQuestion("Câu một", ["B"]);
    await addQuestion("Câu hai", ["A"]);
    const qs = await loadQuestions(adminDb(), quizId);
    expect(qs.map((q) => q.position)).toEqual([1, 2]);
    expect(qs[0].options.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
    expect(qs[0]).toMatchObject({ answerStatus: "verified", answerSource: "manually_verified" });
  });

  it("deleting a question closes the gap in positions", async () => {
    await addQuestion("1", ["A"]);
    const second = await addQuestion("2", ["A"]);
    await addQuestion("3", ["A"]);
    expect((await deleteQuestion(adminDb(), quizId, second)).ok).toBe(true);
    const qs = await loadQuestions(adminDb(), quizId);
    expect(qs.map((q) => [q.content, q.position])).toEqual([["1", 1], ["3", 2]]);
  });

  it("keeps original_answer immutable while the current answer changes", async () => {
    const id = await addQuestion("Câu", ["B"]);
    const db = adminDb();
    await db.from("questions").update({ original_answer: ["B"], answer_source: "pdf_extracted", answer_status: "extracted_valid" }).eq("id", id);

    const res = await saveQuestion(db, quizId, id, { content: "Câu", selectionType: "single", explanation: null, options: opts(["C"]) });
    expect(res.ok).toBe(true);
    const [q] = await loadQuestions(db, quizId);
    expect(q).toMatchObject({ originalAnswer: ["B"], answerSource: "manually_verified", answerStatus: "verified" });
    expect(q.options.find((o) => o.isCorrect)?.label).toBe("C");

    const { error } = await db.from("questions").update({ original_answer: ["C"] }).eq("id", id);
    expect(error?.message).toMatch(/immutable/);
  });

  it("verifyQuestions confirms answered questions and skips unanswered ones", async () => {
    const a = await addQuestion("Có đáp án", ["A"]);
    const b = await addQuestion("Chưa có", []);
    const db = adminDb();
    await db.from("questions").update({ answer_status: "ai_suggested", answer_source: "ai_generated" }).eq("id", a);
    const res = await verifyQuestions(db, quizId, [a, b]);
    expect(res).toEqual({ ok: true, data: { verified: 1, skipped: 1 } });
    const qs = await loadQuestions(db, quizId);
    expect(qs.find((q) => q.id === a)).toMatchObject({ answerStatus: "verified", answerSource: "ai_generated" });
    expect(qs.find((q) => q.id === b)).toMatchObject({ answerStatus: "missing" });
  });
});

describe("publishing and versions", () => {
  it("blocks publishing with listed issues, then publishes v1 once fixed", async () => {
    await addQuestion("Đúng", ["B"]);
    const missing = await addQuestion("Thiếu", []);
    const blocked = await publishQuiz(adminDb(), quizId, adminId);
    expect(blocked).toMatchObject({ ok: true, data: { published: false } });
    if (blocked.ok && !blocked.data.published) {
      expect(blocked.data.issues.map((i) => i.code).sort()).toEqual(["NO_CORRECT", "UNVERIFIED"]);
      expect(blocked.data.issues.every((i) => i.questionId === missing)).toBe(true);
    }

    await saveQuestion(adminDb(), quizId, missing, { content: "Thiếu", selectionType: "single", explanation: null, options: opts(["D"]) });
    const res = await publishQuiz(adminDb(), quizId, adminId);
    expect(res).toEqual({ ok: true, data: { published: true, versionNo: 1 } });

    const { data: v } = await adminDb().from("quiz_versions").select("snapshot, question_count").single();
    expect(v!.question_count).toBe(2);
    expect(v!.snapshot.versionNo).toBe(1);
    expect(v!.snapshot.questions.map((q: { correct: string[] }) => q.correct)).toEqual([["B"], ["D"]]);
    expect(v!.snapshot.subjectName).toBe("Pháp luật đại cương");
  });

  it("Mode B refuses a question with a single correct answer", async () => {
    await addQuestion("Hai đáp án", ["A", "C"], "multiple");
    await addQuestion("Một đáp án", ["B"], "multiple");
    await updateQuizSettings(adminDb(), quizId, { title: "Đề 01", subjectId, durationMinutes: 30, defaultMode: "multiple" });
    const res = await publishQuiz(adminDb(), quizId, adminId);
    expect(res.ok && !res.data.published && res.data.issues.map((i) => i.code)).toEqual(["MULTIPLE_NEEDS_TWO"]);
  });

  it("published quizzes are locked; republishing creates v2 and v1 stays unchanged", async () => {
    const id = await addQuestion("Câu gốc", ["A"]);
    await publishQuiz(adminDb(), quizId, adminId);

    const locked = await saveQuestion(adminDb(), quizId, id, { content: "Sửa", selectionType: "single", explanation: null, options: opts(["B"]) });
    expect(locked).toMatchObject({ ok: false, code: "CONFLICT" });

    expect((await setQuizStatus(adminDb(), quizId, "unpublish")).ok).toBe(true);
    await saveQuestion(adminDb(), quizId, id, { content: "Sửa", selectionType: "single", explanation: null, options: opts(["B"]) });
    expect(await publishQuiz(adminDb(), quizId, adminId)).toEqual({ ok: true, data: { published: true, versionNo: 2 } });

    const { data: versions } = await adminDb().from("quiz_versions").select("version_no, snapshot").order("version_no");
    expect(versions![0].snapshot.questions[0]).toMatchObject({ content: "Câu gốc", correct: ["A"] });
    expect(versions![1].snapshot.questions[0]).toMatchObject({ content: "Sửa", correct: ["B"] });

    const { error } = await adminDb().from("quiz_versions").update({ question_count: 99 }).eq("version_no", 1);
    expect(error?.message).toMatch(/immutable/);
  });

  it("status transitions and deletion rules", async () => {
    await addQuestion("Câu", ["A"]);
    expect(await setQuizStatus(adminDb(), quizId, "archive")).toMatchObject({ ok: false, code: "CONFLICT" });
    await publishQuiz(adminDb(), quizId, adminId);
    expect((await setQuizStatus(adminDb(), quizId, "archive")).ok).toBe(true);
    expect((await setQuizStatus(adminDb(), quizId, "unarchive")).ok).toBe(true);
    expect(await deleteQuiz(adminDb(), quizId)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await deleteSubject(adminDb(), subjectId)).toMatchObject({ ok: false, code: "CONFLICT" });

    const draft = await createQuiz(adminDb(), { title: "Nháp", subjectId, createdBy: adminId });
    expect((await deleteQuiz(adminDb(), draft.ok ? draft.data.id : "")).ok).toBe(true);
  });

  it("rejects duplicate subject names regardless of case", async () => {
    expect(await saveSubject(adminDb(), null, { name: "PHÁP LUẬT ĐẠI CƯƠNG" })).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});

describe("answer-key protection (RLS)", () => {
  beforeEach(async () => {
    await addQuestion("Câu bí mật", ["C"]);
    await publishQuiz(adminDb(), quizId, adminId);
    await createQuiz(adminDb(), { title: "Đề nháp", subjectId, createdBy: adminId });
  });

  it("students see published quizzes and version metadata only", async () => {
    const db = await signInAs("student@test.local");
    const { data: quizzes } = await db.from("quizzes").select("title, quiz_versions!quizzes_current_version_fk(question_count)");
    expect(quizzes).toEqual([{ title: "Đề 01", quiz_versions: { question_count: 1 } }]);

    for (const table of ["questions", "question_options"]) {
      const { data } = await db.from(table).select("*");
      expect(data ?? []).toEqual([]);
    }
    const { data: snap, error } = await db.from("quiz_versions").select("snapshot");
    expect(snap).toBeNull();
    expect(error?.message).toMatch(/permission denied/);
  });

  it("students cannot write quiz tables", async () => {
    const db = await signInAs("student@test.local");
    const { error } = await db.from("subjects").insert({ name: "Hack" });
    expect(error).not.toBeNull();
    const { data } = await db.from("quizzes").update({ title: "Hacked" }).eq("id", quizId).select();
    expect(data ?? []).toEqual([]);
    const { error: rpcErr } = await db.rpc("publish_quiz", { p_quiz: quizId, p_user: adminId, p_snapshot: {}, p_question_count: 1 });
    expect(rpcErr).not.toBeNull();
  });

  it("admins read questions with their own session", async () => {
    const db = await signInAs("admin@test.local");
    expect(await loadQuestions(db, quizId)).toHaveLength(1);
  });
});
