import { describe, expect, it } from "vitest";
import { GRACE_SECONDS, acceptsSave, effectiveSubmit, remainingMs } from "./deadline";
import { formatScore, gradeAttempt, gradeQuestion, roundHalfUp } from "./grade";

describe("gradeQuestion (SRD FR-07 examples)", () => {
  it("1: single correct match", () => expect(gradeQuestion(["B"], ["B"])).toBe("correct"));
  it("2: exact multi-answer set", () => expect(gradeQuestion(["A", "C"], ["C", "A"])).toBe("correct"));
  it("3: missing a correct option → no credit", () => expect(gradeQuestion(["A", "C"], ["A"])).toBe("incorrect"));
  it("4: an extra wrong option → no credit", () => expect(gradeQuestion(["A", "C"], ["A", "B", "C"])).toBe("incorrect"));
  it("wrong single pick", () => expect(gradeQuestion(["B"], ["D"])).toBe("incorrect"));
  it("nothing selected → unanswered", () => expect(gradeQuestion(["B"], [])).toBe("unanswered"));
  it("ignores duplicates and case", () => expect(gradeQuestion(["A", "C"], ["a", "C", "C"])).toBe("correct"));
});

describe("gradeAttempt", () => {
  const snapshot = {
    questions: Array.from({ length: 42 }, (_, i) => ({ id: `q${i}`, correct: ["A"] })),
  };

  it("scores fully-correct / total × 10 with equal weight", () => {
    const answers = new Map(Array.from({ length: 7 }, (_, i) => [`q${i}`, ["A"]]));
    answers.set("q10", ["B"]);
    const r = gradeAttempt(snapshot, answers);
    expect(r).toMatchObject({ total: 42, correct: 7, incorrect: 1, unanswered: 34, score: 1.6667 });
    expect(r.perQuestion.get("q0")).toBe("correct");
    expect(r.perQuestion.get("q10")).toBe("incorrect");
    expect(r.perQuestion.get("q41")).toBe("unanswered");
  });

  it("0 and 10 at the extremes", () => {
    expect(gradeAttempt(snapshot, new Map()).score).toBe(0);
    expect(gradeAttempt(snapshot, new Map(snapshot.questions.map((q) => [q.id, ["A"]]))).score).toBe(10);
  });

  it("ignores answers to questions that are not in the snapshot", () => {
    expect(gradeAttempt(snapshot, new Map([["nope", ["A"]]])).correct).toBe(0);
  });
});

describe("score display", () => {
  it("rounds half up to 2 decimals, Vietnamese decimal comma", () => {
    expect(formatScore(1.6667)).toBe("1,67");
    expect(formatScore(0.125)).toBe("0,13");
    expect(formatScore(7.1429)).toBe("7,14");
    expect(formatScore(10)).toBe("10");
    expect(formatScore(5)).toBe("5");
    expect(roundHalfUp(2.675, 2)).toBe(2.68); // float-safe
  });
});

describe("deadline rules", () => {
  const deadline = new Date("2026-11-18T10:00:00Z");
  const at = (s: number) => new Date(deadline.getTime() + s * 1000);

  it("accepts saves until deadline + grace", () => {
    expect(GRACE_SECONDS).toBe(10);
    expect(acceptsSave(at(-60), deadline)).toBe(true);
    expect(acceptsSave(at(9), deadline)).toBe(true);
    expect(acceptsSave(at(10), deadline)).toBe(true);
    expect(acceptsSave(at(11), deadline)).toBe(false);
  });

  it("a submission after the deadline counts as timeout, capped at the deadline", () => {
    expect(effectiveSubmit(at(-5), deadline, "manual")).toEqual({ reason: "manual", submittedAt: at(-5) });
    expect(effectiveSubmit(at(5), deadline, "manual")).toEqual({ reason: "timeout", submittedAt: deadline });
    expect(effectiveSubmit(at(3600), deadline, "manual")).toEqual({ reason: "timeout", submittedAt: deadline });
  });

  it("remaining time uses the server clock offset and never goes negative", () => {
    // client clock is 30 s behind the server
    const offsetMs = 30_000;
    expect(remainingMs(deadline, at(-90).getTime() - offsetMs, offsetMs)).toBe(90_000);
    expect(remainingMs(deadline, at(5).getTime(), 0)).toBe(0);
  });
});
