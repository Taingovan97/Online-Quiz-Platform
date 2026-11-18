import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Item } from "./extract";
import { buildLines, joinItems } from "./lines";
import { parsePdfItems } from "./parse";

const FIXTURE: Item[] = JSON.parse(readFileSync("tests/fixtures/pdf/PLDC1.items.json", "utf8"));
const clone = () => FIXTURE.map((i) => ({ ...i }));

// Hand-transcribed from the last page of PLDC1.pdf (outer-letter labels).
const KEY =
  "B D D D A B C A B B B B A B A A D D A B A C B B C D B C D C A A A C A B B B A A C C".split(" ");

const keyItem = (items: Item[], n: number) => items.find((i) => i.page === 8 && i.str.startsWith(`${n}. `))!;

describe("joinItems / buildLines", () => {
  it("joins touching fragments without spaces and separates words", () => {
    const items: Item[] = [
      { page: 1, str: "Pháp lu", x: 98.36, y: 10, w: 36.43, h: 10 },
      { page: 1, str: "ậ", x: 134.69, y: 10, w: 5.87, h: 10 },
      { page: 1, str: "t", x: 140.46, y: 10.3, w: 3.76, h: 10 },
      { page: 1, str: "đ", x: 146.76, y: 10, w: 6.48, h: 10 },
      { page: 1, str: "ại", x: 153.13, y: 10, w: 8, h: 10 },
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(1);
    expect(joinItems(lines[0].items)).toBe("Pháp luật đại");
  });

  it("drops duplicate combining marks left after NFC", () => {
    expect(joinItems([{ page: 1, str: "thuế́", x: 0, y: 0, w: 10, h: 10 }])).toBe("thuế");
  });
});

describe("parsePdfItems on PLDC1", () => {
  const result = parsePdfItems(FIXTURE);

  it("reads the header", () => {
    expect(result.title).toBe("Pháp luật đại cương 01");
    expect(result.expectedCount).toBe(42);
  });

  it("extracts 42 questions with 4 options labelled by outer letter", () => {
    expect(result.questions.map((q) => q.number)).toEqual(Array.from({ length: 42 }, (_, i) => i + 1));
    for (const q of result.questions) {
      expect(q.options.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
      for (const o of q.options) {
        expect(o.content).not.toMatch(/^[A-F]\s*\./); // inner label stripped
        expect(o.content.length).toBeGreaterThan(0);
      }
    }
  });

  it("maps every key entry to its question (outer letters), all valid", () => {
    expect(result.questions.map((q) => q.answer?.join(""))).toEqual(KEY);
    expect(result.questions.every((q) => q.status === "extracted_valid")).toBe(true);
    expect(result.questions.every((q) => q.selectionType === "single")).toBe(true);
    expect(result.summary).toEqual({
      total: 42, extractedValid: 42, missing: 0, invalid: 0, ambiguous: 0, keyFound: true,
    });
  });

  it("handles wrapped options and outer letters on a continuation line", () => {
    const q = (n: number) => result.questions[n - 1];
    expect(q(1).options[1].content).toBe("Khoa học pháp lý cơ bản"); // answer B
    expect(q(8).options[3].content).toBe(
      "Nhà nước ban hành các loại thuế và thực hiện thu thuế dưới hình thức bắt buộc",
    );
    expect(q(11).options[0].content).toBe(
      "Nhà nước phân chia và quản lý cư dân của mình theo đơn vi hành chính – lãnh thổ.",
    );
    expect(q(38).options[3].content).toMatch(/^tên gọi của cá nhân, tổ chức dung trong hoạt động kinh doanh/);
    expect(q(41).options[0].content).toBe(
      "Tội phạm là những hành vi nguy hiểm gây ra hậu quả lớn cho xã hội Nhà nước cần phải nghiêm trị.",
    );
    expect(q(19).stem).toBe(
      "Việc tòa án thường đưa các vụ án đi xét xử lưu động thể hiện chủ yếu chức năng nào của pháp luật",
    );
  });

  it("never turns answer-key lines into questions", () => {
    expect(result.questions.at(-1)!.options.map((o) => o.content)).toEqual([
      "Chế độ chính trị, kinh tế, xã hội",
      "Bộ máy nhà nước",
      "Quan hệ tài sản và quan hệ nhân thân",
      "Tội phạm và hình phạt",
    ]);
    expect(result.questions.some((q) => /Đáp án|\d+\. [a-d]\b/.test(q.stem))).toBe(false);
  });

  it("reports only the stray '?' and the four letter-referencing options", () => {
    expect(result.warnings.map((w) => `${w.code}#${w.questionNumber}`).sort()).toEqual(
      ["LETTER_REFERENCE#19", "LETTER_REFERENCE#35", "LETTER_REFERENCE#39", "LETTER_REFERENCE#7", "STRAY_TEXT#6"],
    );
  });
});

describe("answer-key variants", () => {
  it("partial key: 5 entries removed → exactly 5 missing, 37 preserved", () => {
    const removed = [3, 9, 17, 30, 42];
    const items = clone().filter((i) => !(i.page === 8 && removed.some((n) => i.str === `${n}. ${KEY[n - 1].toLowerCase()}`)));
    const r = parsePdfItems(items);
    expect(r.summary).toMatchObject({ total: 42, extractedValid: 37, missing: 5 });
    expect(r.questions.filter((q) => q.status === "missing").map((q) => q.number)).toEqual(removed);
  });

  it("an entry for a non-existent question is reported as orphan", () => {
    const items = clone();
    const last = keyItem(items, 42);
    items.push({ ...last, str: "43. b", x: last.x + 113 });
    expect(parsePdfItems(items).warnings).toContainEqual(expect.objectContaining({ code: "ORPHAN_KEY_ENTRY", questionNumber: 43 }));
  });

  it("an answer letter the question does not have is INVALID", () => {
    const items = clone();
    keyItem(items, 12).str = "12. f";
    const q = parsePdfItems(items).questions[11];
    expect(q).toMatchObject({ status: "invalid", answer: ["F"] });
  });

  it("conflicting entries for the same question are AMBIGUOUS", () => {
    const items = clone();
    const last = keyItem(items, 42);
    items.push({ ...last, str: "7. a", x: last.x + 113 });
    const r = parsePdfItems(items);
    expect(r.questions[6].status).toBe("ambiguous");
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: "DUPLICATE_KEY_ENTRY", questionNumber: 7 }));
  });

  it("multi-letter entries make multiple-answer questions", () => {
    const items = clone();
    keyItem(items, 1).str = "1. a, c";
    expect(parsePdfItems(items).questions[0]).toMatchObject({ answer: ["A", "C"], selectionType: "multiple", status: "extracted_valid" });
  });

  it("no answer key: all questions missing, import still succeeds", () => {
    const r = parsePdfItems(clone().filter((i) => i.page !== 8));
    expect(r.summary).toEqual({ total: 42, extractedValid: 0, missing: 42, invalid: 0, ambiguous: 0, keyFound: false });
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: "NO_ANSWER_KEY" }));
    expect(r.questions[41].options).toHaveLength(4);
  });

  it("a duplicated outer letter makes the question AMBIGUOUS with a grid warning", () => {
    const items = clone();
    // Q1's bottom-left outer letter "C" → "A"
    const q1y = items.find((i) => i.page === 1 && i.str === "1.")!.y;
    const c = items.find((i) => i.page === 1 && i.str === "C" && i.y > q1y && Math.round(i.x) === 71)!;
    c.str = "A";
    const r = parsePdfItems(items);
    expect(r.questions[0].status).toBe("ambiguous");
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: "GRID_MISMATCH", questionNumber: 1 }));
  });
});

describe("other key formats (synthetic)", () => {
  const line = (y: number, ...parts: [number, string][]): Item[] =>
    parts.map(([x, str]) => ({ page: 1, str, x, y, w: str.length * 5, h: 10 }));

  const doc = (keyLines: Item[]) => [
    ...line(10, [74, "1."], [98, "Câu hỏi một"]),
    ...line(30, [71, "A"], [98, "A. Một"], [303, "B"], [330, "B. Hai"]),
    ...line(50, [71, "C"], [98, "C. Ba"], [303, "D"], [330, "D. Bốn"]),
    ...line(70, [74, "2."], [98, "Câu hỏi hai"]),
    ...line(90, [71, "A"], [98, "A. Một"], [303, "B"], [330, "B. Hai"]),
    ...line(110, [71, "C"], [98, "C. Ba"], [303, "D"], [330, "D. Bốn"]),
    ...keyLines,
  ];

  it("Format A/D/E: 'Câu N: X, Y' per line with explanations", () => {
    const r = parsePdfItems(
      doc([
        ...line(200, [74, "ĐÁP ÁN"]),
        ...line(220, [74, "Câu 1: A, C"]),
        ...line(240, [74, "Giải thích: Vì lý do một."]),
        ...line(260, [74, "Câu 2: B"]),
      ]),
    );
    expect(r.questions.map((q) => [q.answer, q.status, q.explanation])).toEqual([
      [["A", "C"], "extracted_valid", "Vì lý do một."],
      [["B"], "extracted_valid", null],
    ]);
  });

  it("Format B: entries on the heading line", () => {
    const r = parsePdfItems(doc(line(200, [74, "Đáp án: 1.B 2.D"])));
    expect(r.questions.map((q) => q.answer)).toEqual([["B"], ["D"]]);
  });
});
