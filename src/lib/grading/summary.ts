export type ScoreRow = { quiz_id: string; status: "in_progress" | "submitted"; score: number | string | null };

/** Best and latest graded score per quiz (requirements A1). `rows` must be newest first. */
export function scoreSummary(rows: ScoreRow[]): Map<string, { best: number; latest: number; inProgress: boolean }> {
  const out = new Map<string, { best: number; latest: number; inProgress: boolean }>();
  for (const r of rows) {
    const entry = out.get(r.quiz_id) ?? { best: -1, latest: -1, inProgress: false };
    if (r.status === "in_progress") entry.inProgress = true;
    if (r.score !== null) {
      const s = Number(r.score);
      if (entry.latest < 0) entry.latest = s;
      entry.best = Math.max(entry.best, s);
    }
    out.set(r.quiz_id, entry);
  }
  return out;
}
