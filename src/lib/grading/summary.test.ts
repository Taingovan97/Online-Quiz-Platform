import { describe, expect, it } from "vitest";
import { scoreSummary } from "./summary";

describe("scoreSummary", () => {
  it("returns best and latest graded score per quiz, newest-first input", () => {
    const s = scoreSummary([
      { quiz_id: "a", status: "in_progress", score: null },
      { quiz_id: "a", status: "submitted", score: "4.5000" },
      { quiz_id: "a", status: "submitted", score: "8.0000" },
      { quiz_id: "b", status: "submitted", score: 0 },
    ]);
    expect(s.get("a")).toEqual({ best: 8, latest: 4.5, inProgress: true });
    expect(s.get("b")).toEqual({ best: 0, latest: 0, inProgress: false });
    expect(s.get("c")).toBeUndefined();
  });
});
