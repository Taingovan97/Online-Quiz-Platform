import { beforeEach, describe, expect, it } from "vitest";
import {
  closeExpiredAttempts,
  getAttemptResult,
  getExamPaper,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type ExamPaper,
} from "@/server/exam";
import { createQuiz, loadQuestions, publishQuiz, saveQuestion, saveSubject, setQuizStatus, updateQuizSettings } from "@/server/quizzes";
import { adminDb, createUser, resetDb, signInAs } from "./helpers";

let adminId: string;
let studentId: string;
let otherId: string;
let subjectId: string;
let quizId: string;
let q: string[]; // question ids: [single B, multiple A+C, single D]

const opts = (correct: string[]) => ["A", "B", "C", "D"].map((l) => ({ content: `PA ${l}`, isCorrect: correct.includes(l) }));

async function setup() {
  await resetDb();
  adminId = await createUser("admin@test.local", "admin");
  studentId = await createUser("student@test.local", "student");
  otherId = await createUser("other@test.local", "student");
  const s = await saveSubject(adminDb(), null, { name: "Môn" });
  subjectId = s.ok ? s.data.id : "";
  const quiz = await createQuiz(adminDb(), { title: "Đề thi", subjectId, createdBy: adminId });
  quizId = quiz.ok ? quiz.data.id : "";
  await updateQuizSettings(adminDb(), quizId, { title: "Đề thi", subjectId, durationMinutes: 30, defaultMode: "mixed" });
  q = [];
  for (const [content, correct, type] of [
    ["Một đáp án B", ["B"], "single"],
    ["Hai đáp án A, C", ["A", "C"], "multiple"],
    ["Một đáp án D", ["D"], "single"],
  ] as const) {
    const r = await saveQuestion(adminDb(), quizId, null, { content, selectionType: type, explanation: `Giải thích: ${content}`, options: opts([...correct]) });
    if (!r.ok) throw new Error(r.message);
    q.push(r.data.id);
  }
  const p = await publishQuiz(adminDb(), quizId, adminId);
  if (!p.ok || !p.data.published) throw new Error("publish failed");
}

async function start(user = studentId) {
  const r = await startAttempt(adminDb(), user, quizId);
  if (!r.ok) throw new Error(r.message);
  return r.data.attemptId;
}

beforeEach(setup);

describe("starting and resuming", () => {
  it("creates one attempt with a server-side deadline and resumes it", async () => {
    const id = await start();
    expect(await start()).toBe(id);
    const { data } = await adminDb().from("attempts").select("started_at, deadline_at, total_questions").eq("id", id).single();
    expect(new Date(data!.deadline_at).getTime() - new Date(data!.started_at).getTime()).toBe(30 * 60_000);
    expect(data!.total_questions).toBe(3);
  });

  it("concurrent starts still yield a single attempt", async () => {
    const ids = await Promise.all([start(), start(), start()]);
    expect(new Set(ids).size).toBe(1);
  });

  it("the exam paper never contains the answer key or explanations", async () => {
    const id = await start();
    const res = await getExamPaper(adminDb(), studentId, id);
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/"correct"|explanation|Giải thích/);
    expect((res.ok && (res.data as ExamPaper).paper.questions.length)).toBe(3);
  });

  it("an unpublished quiz cannot be started", async () => {
    await setQuizStatus(adminDb(), quizId, "unpublish");
    expect(await startAttempt(adminDb(), studentId, quizId)).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("another student cannot open someone else's attempt", async () => {
    const id = await start();
    expect(await getExamPaper(adminDb(), otherId, id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await saveAnswer(adminDb(), otherId, { attemptId: id, questionId: q[0], labels: ["B"] })).toMatchObject({ ok: false });
  });
});

describe("saving answers", () => {
  it("persists and revises answers (resume after refresh)", async () => {
    const id = await start();
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["A"] });
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["B"] });
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[1], labels: ["C", "A"] });
    const res = await getExamPaper(adminDb(), studentId, id);
    expect(res.ok && (res.data as ExamPaper).answers).toEqual({ [q[0]]: ["B"], [q[1]]: ["A", "C"] });
  });

  it("rejects unknown questions, unknown labels and multiple picks on single questions", async () => {
    const id = await start();
    for (const input of [
      { questionId: crypto.randomUUID(), labels: ["A"] },
      { questionId: q[0], labels: ["E"] },
      { questionId: q[0], labels: ["A", "B"] },
    ]) {
      expect(await saveAnswer(adminDb(), studentId, { attemptId: id, ...input })).toMatchObject({ ok: false, code: "VALIDATION" });
    }
  });

  it("accepts saves within the grace period and rejects them after it", async () => {
    const id = await start();
    const setDeadline = (secondsAgo: number) =>
      adminDb().from("attempts").update({
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
        deadline_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
      }).eq("id", id);

    await setDeadline(5);
    expect((await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["B"] })).ok).toBe(true);
    await setDeadline(15);
    expect(await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[2], labels: ["D"] })).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  });
});

describe("submission and grading", () => {
  it("grades by exact match: 1 correct of 3 → 3.3333", async () => {
    const id = await start();
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["B"] }); // correct
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[1], labels: ["A"] }); // missing C → wrong
    // q[2] unanswered
    expect(await submitAttempt(adminDb(), studentId, id)).toEqual({ ok: true, data: { attemptId: id } });

    const res = await getAttemptResult(adminDb(), { id: studentId, role: "student" }, id);
    expect(res.ok && res.data.attempt).toMatchObject({
      status: "submitted", submit_reason: "manual", correct_count: 1, incorrect_count: 1, unanswered_count: 1,
    });
    expect(res.ok && Number(res.data.attempt.score)).toBe(3.3333);
    expect(res.ok && res.data.snapshot.questions[1].explanation).toContain("Giải thích");
  });

  it("concurrent submissions produce exactly one result", async () => {
    const id = await start();
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["B"] });
    const all = await Promise.all([1, 2, 3, 4].map(() => submitAttempt(adminDb(), studentId, id)));
    expect(all.every((r) => r.ok)).toBe(true);
    const { data } = await adminDb().from("attempts").select("status, correct_count, graded_at").eq("quiz_id", quizId);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ status: "submitted", correct_count: 1 });
  });

  it("a submitted attempt cannot be modified", async () => {
    const id = await start();
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["B"] });
    await submitAttempt(adminDb(), studentId, id);

    expect(await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[2], labels: ["D"] })).toMatchObject({ ok: false, code: "ATTEMPT_CLOSED" });
    // Even the secret key cannot rewrite it.
    const { error: e1 } = await adminDb().from("attempt_answers").update({ selected_labels: ["A"] }).eq("attempt_id", id);
    expect(e1?.message).toMatch(/ATTEMPT_CLOSED/);
    const { error: e2 } = await adminDb().from("attempts").update({ score: 10 }).eq("id", id);
    expect(e2?.message).toMatch(/ATTEMPT_IMMUTABLE/);
  });

  it("an abandoned attempt is finalized as timeout with its saved answers when next accessed", async () => {
    const id = await start();
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["B"] });
    const deadline = new Date(Date.now() - 60_000);
    await adminDb().from("attempts").update({ started_at: new Date(Date.now() - 3_600_000).toISOString(), deadline_at: deadline.toISOString() }).eq("id", id);

    const paper = await getExamPaper(adminDb(), studentId, id);
    expect(paper).toEqual({ ok: true, data: { submitted: true } });
    const { data } = await adminDb().from("attempts").select("submit_reason, submitted_at, correct_count, graded_at").eq("id", id).single();
    expect(data).toMatchObject({ submit_reason: "timeout", correct_count: 1 });
    expect(new Date(data!.submitted_at).getTime()).toBe(deadline.getTime());
  });

  it("closeExpiredAttempts for everyone (admin listing) leaves running attempts alone", async () => {
    const running = await start();
    const expired = await start(otherId);
    await adminDb().from("attempts").update({ started_at: new Date(Date.now() - 3_600_000).toISOString(), deadline_at: new Date(Date.now() - 30_000).toISOString() }).eq("id", expired);
    await closeExpiredAttempts(adminDb(), null);
    const { data } = await adminDb().from("attempts").select("id, status").order("started_at");
    expect(Object.fromEntries(data!.map((a) => [a.id, a.status]))).toEqual({ [running]: "in_progress", [expired]: "submitted" });
  });

  it("a submission whose grading was interrupted is graded on the next read", async () => {
    const id = await start();
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[2], labels: ["D"] });
    await adminDb().rpc("claim_submission", { p_user: studentId, p_attempt: id, p_reason: "manual" });
    const res = await getAttemptResult(adminDb(), { id: studentId, role: "student" }, id);
    expect(res.ok && res.data.attempt).toMatchObject({ correct_count: 1, unanswered_count: 2 });
  });
});

describe("history integrity", () => {
  it("editing and republishing a quiz never changes a past result", async () => {
    const id = await start();
    await saveAnswer(adminDb(), studentId, { attemptId: id, questionId: q[0], labels: ["B"] });
    await submitAttempt(adminDb(), studentId, id);
    const before = await getAttemptResult(adminDb(), { id: studentId, role: "student" }, id);

    await setQuizStatus(adminDb(), quizId, "unpublish");
    await saveQuestion(adminDb(), quizId, q[0], { content: "Đã sửa", selectionType: "single", explanation: null, options: opts(["A"]) });
    expect(await publishQuiz(adminDb(), quizId, adminId)).toMatchObject({ ok: true, data: { versionNo: 2 } });

    const after = await getAttemptResult(adminDb(), { id: studentId, role: "student" }, id);
    expect(after).toEqual(before);
    expect(after.ok && after.data.snapshot.questions[0]).toMatchObject({ content: "Một đáp án B", correct: ["B"] });
    expect((await loadQuestions(adminDb(), quizId))[0].content).toBe("Đã sửa");
  });

  it("an attempt in progress keeps its original version after a republish", async () => {
    const id = await start();
    await setQuizStatus(adminDb(), quizId, "unpublish");
    await saveQuestion(adminDb(), quizId, q[0], { content: "Bản mới", selectionType: "single", explanation: null, options: opts(["A"]) });
    await publishQuiz(adminDb(), quizId, adminId);
    const paper = await getExamPaper(adminDb(), studentId, id);
    expect(paper.ok && (paper.data as ExamPaper).paper.questions[0].content).toBe("Một đáp án B");
  });
});

describe("RLS on attempts", () => {
  it("students read only their own attempts, and answers only after submitting", async () => {
    const mine = await start();
    await start(otherId);
    await saveAnswer(adminDb(), studentId, { attemptId: mine, questionId: q[0], labels: ["B"] });

    const db = await signInAs("student@test.local");
    const { data: attempts } = await db.from("attempts").select("id");
    expect(attempts).toEqual([{ id: mine }]);
    expect((await db.from("attempt_answers").select("*")).data ?? []).toEqual([]);

    await submitAttempt(adminDb(), studentId, mine);
    expect((await db.from("attempt_answers").select("question_id")).data).toHaveLength(1);
  });

  it("students cannot call exam functions or write attempts directly", async () => {
    const id = await start();
    const db = await signInAs("student@test.local");
    const { error: rpc } = await db.rpc("record_grade", { p_attempt: id, p_results: {}, p_correct: 3, p_incorrect: 0, p_unanswered: 0, p_score: 10 });
    expect(rpc).not.toBeNull();
    const { data } = await db.from("attempts").update({ deadline_at: new Date(Date.now() + 9e9).toISOString() }).eq("id", id).select();
    expect(data ?? []).toEqual([]);
    const { error } = await db.from("attempt_answers").insert({ attempt_id: id, question_id: q[0], selected_labels: ["B"] });
    expect(error).not.toBeNull();
  });
});
