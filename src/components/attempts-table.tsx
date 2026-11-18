import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatScore } from "@/lib/grading/grade";
import { t } from "@/lib/i18n/vi";
import type { HistoryRow } from "@/server/history";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

function spent(r: HistoryRow) {
  if (!r.submitted_at) return "–";
  const s = Math.max(0, Math.round((Date.parse(r.submitted_at) - Date.parse(r.started_at)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AttemptsTable({ rows, showUser = false }: { rows: HistoryRow[]; showUser?: boolean }) {
  if (rows.length === 0) return <p className="text-muted-foreground">{t.placeholder.history}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {showUser && <TableHead>{t.history.student}</TableHead>}
            <TableHead>{t.history.quiz}</TableHead>
            <TableHead>{t.history.date}</TableHead>
            <TableHead className="text-right">{t.history.correct}</TableHead>
            <TableHead className="text-right">{t.history.score}</TableHead>
            <TableHead className="text-right">{t.history.time}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              {showUser && <TableCell>{r.profiles?.full_name}</TableCell>}
              <TableCell className="font-medium">{r.quizzes?.title}</TableCell>
              <TableCell>{dateFmt.format(new Date(r.started_at))}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.status === "submitted" ? `${r.correct_count ?? 0}/${r.total_questions}` : "–"}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {r.score === null ? "–" : formatScore(Number(r.score))}
              </TableCell>
              <TableCell className="text-right tabular-nums">{spent(r)}</TableCell>
              <TableCell className="text-right">
                {r.status === "in_progress" ? (
                  showUser ? (
                    <Badge variant="outline">{t.history.inProgress}</Badge>
                  ) : (
                    <Link href={`/attempts/${r.id}`} className="text-sm underline">
                      {t.exam.continue}
                    </Link>
                  )
                ) : (
                  <span className="flex justify-end gap-3 text-sm">
                    <Link href={`/attempts/${r.id}/result`} className="underline">
                      {t.history.review}
                    </Link>
                    {!showUser && (
                      <Link href={`/attempts/${r.id}/result?filter=wrong`} className="underline">
                        {t.history.wrongOnly}
                      </Link>
                    )}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
