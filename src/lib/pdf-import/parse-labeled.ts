import type { Highlight, Item } from "./extract";
import { buildLines, joinItems, type Line } from "./lines";
import type { ParsedQuestion, ParsedQuiz, ParseWarning } from "./types";

/*
 * Parser for the "labelled options + highlighted answer" layout (docs/design.md §C.2):
 *
 *   Câu 1 [Nguồn]: Question stem (may wrap)
 *   A. option     B. option     C. option     D. option      ← 1–4 options per row
 *   ...
 *
 * There is no answer key: the correct option is painted with a highlighter colour.
 * An option is marked when its label (or first text run) lies inside a highlight box.
 * Labels must run A, B, C… in order, which keeps "1 / 2" or "Vitamin A." in option
 * text from being mistaken for a new option.
 */

const LETTERS = "ABCDEF";
export const LABELED_HEAD = /^câu\s*(\d{1,3})\s*(?:\[[^\]]*\]|\([^)]*\))?\s*[:.]\s*(.*)$/iu;
const LABEL = /^([A-F])\s*[.)](?:\s+(.*))?$/u;
const END = /^[-–—\s]*(?:hết|het)[-–—\s.]*$/iu;
const STRAY = /^[?!.,;:*•·\-–—_]+$/;
const BLANK = "_____";
// Same rule as the grid parser: option text that names other options by letter.
const LETTER_REF = /(?<!\p{L})(?:[Cc]ả|[Đđ]áp án|[Pp]hương án)(?!\p{L})[^.]*?(?<!\p{L})[A-F](?!\p{L})/u;

type OptionAcc = { label: string; labelX: number; anchors: Item[]; parts: string[] };
type QuestionAcc = { number: number; stem: string[]; options: OptionAcc[]; lastRow: OptionAcc[] };

/** True when the document uses "Câu N:" question headings at the left margin. */
export function looksLabeled(items: Item[]): boolean {
  const lines = buildLines(items);
  const margin = leftMargin(items);
  return lines.filter((l) => isHead(l, margin)).length >= 2;
}

function leftMargin(items: Item[]): number {
  const xs = items.map((i) => Math.round(i.x)).sort((a, b) => a - b);
  return xs[Math.floor(xs.length * 0.05)] ?? 0;
}

const isHead = (l: Line, margin: number) => l.items[0].x <= margin + 20 && LABELED_HEAD.test(joinItems(l.items));

/** Text of a line, with a blank marker where a wide gap (fill-in-the-blank) separates runs. */
function textWithBlanks(items: Item[], margin: number | null): string {
  const groups: Item[][] = [];
  for (const it of items) {
    const prev = groups.at(-1)?.at(-1);
    if (prev && it.x - (prev.x + prev.w) > 20) groups.push([it]);
    else if (prev) groups.at(-1)!.push(it);
    else groups.push([it]);
  }
  const text = groups.map((g) => joinItems(g)).join(` ${BLANK} `);
  return margin !== null && items[0].x > margin + 25 ? `${BLANK} ${text}` : text;
}

export function parseLabeled(items: Item[], highlights: Highlight[]): ParsedQuiz {
  const warnings: ParseWarning[] = [];
  const lines = buildLines(items);
  const margin = leftMargin(items);

  const firstQuestion = lines.findIndex((l) => isHead(l, margin));
  const headerLines = lines.slice(0, Math.max(firstQuestion, 0));
  const header = headerLines.map((l) => joinItems(l.items));
  const countMatch = header.join(" ").match(/(\d+)\s*câu(?:\s*hỏi)?(?!\p{L})/iu);
  const expectedCount = countMatch ? Number(countMatch[1]) : null;
  // Title: the first line set in the largest type, skipping the "78 CÂU" line.
  const candidates = headerLines.filter((l) => !/\d+\s*câu/iu.test(joinItems(l.items)));
  const maxH = Math.max(0, ...candidates.map((l) => Math.max(...l.items.map((i) => i.h))));
  const titleLine = candidates.find((l) => Math.max(...l.items.map((i) => i.h)) === maxH);
  const title = titleLine ? joinItems(titleLine.items) : null;

  const accs: QuestionAcc[] = [];
  let current: QuestionAcc | null = null;
  for (const line of lines.slice(Math.max(firstQuestion, 0))) {
    const full = joinItems(line.items);
    if (END.test(full)) break;

    if (isHead(line, margin)) {
      const m = full.match(LABELED_HEAD)!;
      // Rebuild the stem from the items after the heading run so blanks are kept.
      const headEnd = line.items.findIndex((it) => /[:.]\s*$/.test(it.str) && /câu/iu.test(joinItems(line.items.slice(0, line.items.indexOf(it) + 1))));
      const stemItems = headEnd >= 0 ? line.items.slice(headEnd + 1) : [];
      const stem = stemItems.length ? textWithBlanks(stemItems, null) : m[2];
      current = { number: Number(m[1]), stem: stem ? [stem] : [], options: [], lastRow: [] };
      accs.push(current);
      continue;
    }
    if (!current) continue;

    const row = splitOptionRow(line, current.options.length);
    if (row) {
      current.options.push(...row);
      current.lastRow = row;
      continue;
    }
    if (current.options.length === 0) {
      if (STRAY.test(full)) warnings.push({ code: "STRAY_TEXT", questionNumber: current.number, detail: full });
      else current.stem.push(textWithBlanks(line.items, margin));
      continue;
    }
    // Continuation of an option: give each run to the nearest option label on its left.
    const byOption = new Map<OptionAcc, Item[]>();
    for (const it of line.items) {
      const owner =
        [...current.lastRow].reverse().find((o) => o.labelX <= it.x + 3) ?? current.lastRow[0];
      byOption.set(owner, [...(byOption.get(owner) ?? []), it]);
    }
    for (const [opt, its] of byOption) {
      const text = joinItems(its);
      if (STRAY.test(text)) warnings.push({ code: "STRAY_TEXT", questionNumber: current.number, detail: text });
      else opt.parts.push(text);
    }
  }

  const seen = new Map<number, number>();
  for (const q of accs) seen.set(q.number, (seen.get(q.number) ?? 0) + 1);
  const keyFound = highlights.length > 0;
  if (!keyFound) {
    warnings.push({ code: "NO_ANSWER_KEY", detail: "Không tìm thấy đáp án được tô màu trong PDF." });
  }

  const questions: ParsedQuestion[] = [];
  let prevNumber = 0;
  for (const q of accs) {
    let ambiguous = false;
    if ((seen.get(q.number) ?? 0) > 1) {
      ambiguous = true;
      if (!warnings.some((w) => w.code === "DUPLICATE_NUMBER" && w.questionNumber === q.number)) {
        warnings.push({ code: "DUPLICATE_NUMBER", questionNumber: q.number, detail: `Câu ${q.number} xuất hiện nhiều lần.` });
      }
    }
    if (q.number !== prevNumber + 1) {
      warnings.push({ code: "NUMBER_GAP", questionNumber: q.number, detail: `Sau câu ${prevNumber} là câu ${q.number}.` });
    }
    prevNumber = q.number;

    const options = q.options.map((o) => ({ label: o.label, content: o.parts.join(" ").replace(/\s+/g, " ").trim() }));
    if (options.length < 2) {
      warnings.push({ code: "TOO_FEW_OPTIONS", questionNumber: q.number, detail: `Câu ${q.number} chỉ có ${options.length} phương án.` });
    }
    for (const o of options) {
      if (LETTER_REF.test(o.content)) {
        warnings.push({ code: "LETTER_REFERENCE", questionNumber: q.number, detail: `${o.label}. ${o.content}` });
      }
    }

    const marked = q.options.filter((o) => o.anchors.some((a) => highlights.some((h) => inside(a, h)))).map((o) => o.label);
    const answer = marked.length ? marked : null;
    const status: ParsedQuestion["status"] = !answer ? "missing" : ambiguous ? "ambiguous" : "extracted_valid";

    questions.push({
      number: q.number,
      stem: q.stem.join(" ").replace(/\s+/g, " ").trim(),
      options,
      answer,
      explanation: null,
      selectionType: answer && answer.length > 1 ? "multiple" : "single",
      status,
    });
  }

  if (expectedCount !== null && expectedCount !== questions.length) {
    warnings.push({ code: "COUNT_MISMATCH", detail: `PDF ghi ${expectedCount} câu nhưng đọc được ${questions.length} câu.` });
  }

  return {
    title,
    expectedCount,
    questions,
    warnings,
    summary: {
      total: questions.length,
      extractedValid: questions.filter((q) => q.status === "extracted_valid").length,
      missing: questions.filter((q) => q.status === "missing").length,
      invalid: questions.filter((q) => q.status === "invalid").length,
      ambiguous: questions.filter((q) => q.status === "ambiguous").length,
      keyFound,
    },
  };
}

/**
 * Splits a line into options when it starts with the next expected label. Further
 * labels on the same line must continue the sequence and sit clearly to the right.
 */
function splitOptionRow(line: Line, already: number): OptionAcc[] | null {
  const label = (it: Item) => it.str.trim().match(LABEL);
  const first = label(line.items[0]);
  if (!first || first[1] !== LETTERS[already]) return null;

  const row: OptionAcc[] = [];
  let open: OptionAcc | null = null;
  let runs: Item[] = [];
  const close = () => {
    if (!open) return;
    const text = joinItems(runs);
    open.parts = text ? [[open.parts[0], text].filter(Boolean).join(" ")] : open.parts;
    if (runs[0]) open.anchors.push(runs[0]);
    row.push(open);
  };
  for (const it of line.items) {
    const m = label(it);
    const expected: string = LETTERS[already + row.length + (open ? 1 : 0)];
    if (m && m[1] === expected && (!open || it.x - open.labelX > 20)) {
      close();
      open = { label: m[1], labelX: it.x, anchors: [it], parts: m[2] ? [m[2]] : [] };
      runs = [];
    } else runs.push(it);
  }
  close();
  return row;
}

function inside(it: Item, h: Highlight): boolean {
  if (it.page !== h.page) return false;
  const cx = it.x + Math.min(it.w, 10) / 2;
  const cy = it.y + it.h / 2;
  return cx >= h.x0 - 2 && cx <= h.x1 + 2 && cy >= h.y0 - 2 && cy <= h.y1 + 2;
}
