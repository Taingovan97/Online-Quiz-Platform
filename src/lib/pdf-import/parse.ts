import type { Item } from "./extract";
import { buildLines, joinItems, type Line } from "./lines";
import type { ImportSummary, ParsedQuestion, ParsedQuiz, ParseWarning } from "./types";

/*
 * Deterministic parser for the supported layout (docs/design.md §C):
 *
 *   N. Question stem (may wrap)
 *   A  C. option text          B  A. option text
 *   C  B. option text          D  D. option text
 *   ...
 *   Đáp án
 *   1. b   2. d   3. d ...
 *
 * The OUTER letter (grid position) identifies an option and is what the key
 * refers to. The inner label ("C.") only marks where an option's text starts and
 * is stripped (decision D4).
 */

const LETTERS = "ABCDEF";
const QUESTION_START = /^(\d{1,3})\.$/;
const INNER_LABEL = /^([A-F])\s*\.\s*/;
const KEY_HEADING = /^đáp\s*án\s*:?\s*(.*)$/iu;
const KEY_ENTRY = /(?:câu\s*)?(\d{1,3})\s*[.:)]\s*([A-Fa-f](?:\s*[,;&]\s*[A-Fa-f])*)(?![\p{L}\p{N}])/giu;
const EXPLANATION = /^giải\s*thích\s*:?\s*(.*)$/iu;
// Option text that names other options ("Cả B và C"). Unicode lookarounds instead of
// \b, which only understands ASCII letters.
const LETTER_REF = /(?<!\p{L})(?:[Cc]ả|[Đđ]áp án|[Pp]hương án)(?!\p{L})[^.]*?(?<!\p{L})[A-F](?!\p{L})/u;
const STRAY = /^[?!.,;:*•·\-–—_]+$/;

type Layout = { leftOuterX: number; rightOuterX: number | null; split: number };

/** Finds the x positions of the lone outer letters (one or two columns). */
function detectLayout(items: Item[]): Layout {
  const counts = new Map<number, number>();
  for (const i of items) {
    if (/^[A-F]$/.test(i.str.trim())) {
      const key = Math.round(i.x / 4) * 4;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const clusters = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([x]) => x)
    .sort((a, b) => a - b);
  const left = clusters[0] ?? 0;
  const right = clusters.length > 1 && clusters[1] - left > 100 ? clusters[1] : null;
  return { leftOuterX: left, rightOuterX: right, split: right === null ? Infinity : right - 6 };
}

const near = (x: number, target: number) => Math.abs(x - target) <= 5;

type ColumnPart = { outer: string | null; text: string };

function splitColumns(line: Line, layout: Layout): [ColumnPart, ColumnPart] {
  const part = (items: Item[], outerX: number | null): ColumnPart => {
    let outer: string | null = null;
    let rest = items;
    const first = items[0];
    if (first && outerX !== null && /^[A-F]$/.test(first.str.trim()) && near(first.x, outerX)) {
      outer = first.str.trim();
      rest = items.slice(1);
    }
    return { outer, text: joinItems(rest) };
  };
  return [
    part(line.items.filter((i) => i.x < layout.split), layout.leftOuterX),
    part(line.items.filter((i) => i.x >= layout.split), layout.rightOuterX),
  ];
}

type OptionAcc = { col: 0 | 1; outer: string | null; parts: string[] };
type QuestionAcc = { number: number; stem: string[]; options: OptionAcc[]; open: [OptionAcc | null, OptionAcc | null] };

export function parsePdfItems(items: Item[]): ParsedQuiz {
  const warnings: ParseWarning[] = [];
  const lines = buildLines(items);
  const layout = detectLayout(items);
  const leftTextX = layout.leftOuterX + 15;

  // 1. Regions: header | questions | answer key
  const isQuestionStart = (l: Line) =>
    QUESTION_START.test(l.items[0]?.str.trim() ?? "") && l.items[0].x < leftTextX;
  const firstQuestion = lines.findIndex(isQuestionStart);
  let keyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = joinItems(lines[i].items).match(KEY_HEADING);
    if (!m) continue;
    const window = [m[1], ...lines.slice(i + 1, i + 4).map((l) => joinItems(l.items))].join(" ");
    if (new RegExp(KEY_ENTRY.source, "iu").test(window)) {
      keyStart = i;
      break;
    }
  }

  const header = lines.slice(0, Math.max(firstQuestion, 0)).map((l) => joinItems(l.items));
  const title =
    header
      .map((h) => h.replace(/(?:TÊN|LỚP|NGÀY)\s*:.*$/u, "").replace(/\d+\s*câu\s*hỏi/iu, "").trim())
      .find(Boolean) ?? null;
  const countMatch = header.join(" ").match(/(\d+)\s*câu\s*hỏi/iu);
  const expectedCount = countMatch ? Number(countMatch[1]) : null;

  const body = firstQuestion < 0 ? [] : lines.slice(firstQuestion, keyStart < 0 ? undefined : keyStart);
  const keyLines = keyStart < 0 ? [] : lines.slice(keyStart);

  // 2. Questions and option grid
  const accs: QuestionAcc[] = [];
  let current: QuestionAcc | null = null;
  for (const line of body) {
    if (isQuestionStart(line)) {
      const number = Number(line.items[0].str.trim().slice(0, -1));
      current = { number, stem: [joinItems(line.items.slice(1))], options: [], open: [null, null] };
      accs.push(current);
      continue;
    }
    if (!current) continue;

    const full = joinItems(line.items);
    const cols = splitColumns(line, layout);
    const isOptionLine = cols.some((c) => c.outer !== null || INNER_LABEL.test(c.text));

    if (!isOptionLine && current.options.length === 0) {
      if (STRAY.test(full)) {
        warnings.push({ code: "STRAY_TEXT", questionNumber: current.number, detail: full });
      } else current.stem.push(full);
      continue;
    }

    cols.forEach((c, idx) => {
      const col = idx as 0 | 1;
      if (!c.text && !c.outer) return;
      const inner = c.text.match(INNER_LABEL);
      if (inner) {
        const opt: OptionAcc = { col, outer: c.outer, parts: [c.text.slice(inner[0].length)] };
        current!.options.push(opt);
        current!.open[col] = opt;
        return;
      }
      const open = current!.open[col];
      if (!open) {
        if (c.text && STRAY.test(c.text)) {
          warnings.push({ code: "STRAY_TEXT", questionNumber: current!.number, detail: c.text });
        } else if (c.text) {
          current!.stem.push(c.text); // text before any option in this column
        }
        return;
      }
      if (c.outer) {
        if (open.outer && open.outer !== c.outer) {
          warnings.push({ code: "GRID_MISMATCH", questionNumber: current!.number, detail: `Chữ cái ${c.outer} lạc vị trí` });
        } else open.outer = c.outer;
      }
      if (c.text) open.parts.push(c.text);
    });
  }

  // 3. Answer key
  const keyEntries = new Map<number, string[][]>();
  const explanations = new Map<number, string>();
  let lastKeyNumber: number | null = null;
  for (const [i, line] of keyLines.entries()) {
    let text = joinItems(line.items);
    if (i === 0) text = text.match(KEY_HEADING)?.[1] ?? "";
    const exp = text.match(EXPLANATION);
    if (exp && lastKeyNumber !== null) {
      explanations.set(lastKeyNumber, [explanations.get(lastKeyNumber), exp[1]].filter(Boolean).join(" "));
      continue;
    }
    for (const m of text.matchAll(KEY_ENTRY)) {
      const n = Number(m[1]);
      const letters = [...new Set(m[2].toUpperCase().split(/[^A-F]+/).filter(Boolean))].sort();
      keyEntries.set(n, [...(keyEntries.get(n) ?? []), letters]);
      lastKeyNumber = n;
    }
  }
  const keyFound = keyEntries.size > 0;
  if (!keyFound) warnings.push({ code: "NO_ANSWER_KEY", detail: "Không tìm thấy bảng đáp án trong PDF." });

  // 4. Build questions, assign outer letters, map answers by number
  const seen = new Map<number, number>();
  for (const q of accs) seen.set(q.number, (seen.get(q.number) ?? 0) + 1);

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

    // Expected label by grid position: left column A, C, E…; right column B, D, F…
    const perCol: [number, number] = [0, 0];
    const expected = q.options.map((o) => {
      const idx = perCol[o.col]++;
      return layout.rightOuterX === null ? LETTERS[idx] : LETTERS[idx * 2 + o.col];
    });
    const outers = q.options.map((o) => o.outer);
    const outerValid =
      outers.every(Boolean) &&
      new Set(outers).size === outers.length &&
      [...outers].sort().join("") === LETTERS.slice(0, outers.length);
    if (!outerValid) {
      ambiguous = true;
      warnings.push({ code: "GRID_MISMATCH", questionNumber: q.number, detail: "Không xác định chắc chắn chữ cái phương án." });
    }
    const options = q.options
      .map((o, i) => ({ label: (outerValid ? o.outer : expected[i]) ?? expected[i], content: o.parts.join(" ").trim() }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (options.length < 2) {
      warnings.push({ code: "TOO_FEW_OPTIONS", questionNumber: q.number, detail: `Câu ${q.number} chỉ có ${options.length} phương án.` });
    }
    for (const o of options) {
      if (LETTER_REF.test(o.content)) {
        warnings.push({ code: "LETTER_REFERENCE", questionNumber: q.number, detail: `${o.label}. ${o.content}` });
      }
    }

    const entries = keyEntries.get(q.number);
    const distinct = entries ? [...new Set(entries.map((e) => e.join(",")))] : [];
    let answer: string[] | null = entries?.[0] ?? null;
    let status: ParsedQuestion["status"];
    if (!entries) status = "missing";
    else if (distinct.length > 1) {
      status = "ambiguous";
      answer = entries[0];
    } else if (!answer!.every((l) => options.some((o) => o.label === l))) status = "invalid";
    else status = ambiguous ? "ambiguous" : "extracted_valid";
    if (entries && entries.length > 1) {
      warnings.push({ code: "DUPLICATE_KEY_ENTRY", questionNumber: q.number, detail: `Đáp án câu ${q.number} xuất hiện ${entries.length} lần.` });
    }

    questions.push({
      number: q.number,
      stem: q.stem.join(" ").replace(/\s+/g, " ").trim(),
      options,
      answer,
      explanation: explanations.get(q.number) ?? null,
      selectionType: answer && answer.length > 1 ? "multiple" : "single",
      status,
    });
  }

  for (const n of keyEntries.keys()) {
    if (!seen.has(n)) warnings.push({ code: "ORPHAN_KEY_ENTRY", questionNumber: n, detail: `Đáp án câu ${n} không khớp câu hỏi nào.` });
  }
  if (expectedCount !== null && expectedCount !== questions.length) {
    warnings.push({ code: "COUNT_MISMATCH", detail: `PDF ghi ${expectedCount} câu nhưng đọc được ${questions.length} câu.` });
  }

  const summary: ImportSummary = {
    total: questions.length,
    extractedValid: questions.filter((q) => q.status === "extracted_valid").length,
    missing: questions.filter((q) => q.status === "missing").length,
    invalid: questions.filter((q) => q.status === "invalid").length,
    ambiguous: questions.filter((q) => q.status === "ambiguous").length,
    keyFound,
  };
  return { title, expectedCount, questions, warnings, summary };
}
