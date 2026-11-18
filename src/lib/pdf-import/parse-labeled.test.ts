import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdf, isHighlightColor, type Highlight, type Item } from "./extract";
import { parsePdfItems } from "./parse";

const FIXTURE: { items: Item[]; highlights: Highlight[] } = JSON.parse(
  readFileSync("tests/fixtures/pdf/LTTDTT.json", "utf8"),
);

describe("parsePdfItems on LTTDTT (labelled options, highlighted answers)", () => {
  const r = parsePdfItems(FIXTURE.items, FIXTURE.highlights);

  it("reads the header", () => {
    expect(r.title).toBe("NGÂN HÀNG TRẮC NGHIỆM – LÝ LUẬN GDTC");
    expect(r.expectedCount).toBe(78);
  });

  it("extracts 78 numbered questions with sequential labels and no warnings", () => {
    expect(r.questions.map((q) => q.number)).toEqual(Array.from({ length: 78 }, (_, i) => i + 1));
    for (const q of r.questions) {
      expect(q.stem).not.toMatch(/^câu/i);
      expect(q.options.length).toBeGreaterThanOrEqual(2); // Q61, Q66 are true/false
      expect(q.options.map((o) => o.label).join("")).toBe("ABCDEF".slice(0, q.options.length));
      for (const o of q.options) expect(o.content.length).toBeGreaterThan(0);
    }
    expect(r.warnings).toEqual([]);
  });

  it("takes exactly one highlighted answer per question", () => {
    expect(r.summary).toEqual({ total: 78, extractedValid: 78, missing: 0, invalid: 0, ambiguous: 0, keyFound: true });
    expect(r.questions.every((q) => q.answer?.length === 1 && q.selectionType === "single")).toBe(true);
  });

  it("handles 1-, 2-, 3- and 4-column option rows", () => {
    const q = (n: number) => r.questions[n - 1];
    // 4 per row
    expect(q(1).options.map((o) => o.content)).toEqual(["775", "776", "777", "778"]);
    expect(q(1).answer).toEqual(["B"]);
    // 3 per row (only three options)
    expect(q(7).options).toHaveLength(3);
    expect(q(7).answer).toEqual(["B"]);
    // 2 per row
    expect(q(8).options[3]).toEqual({ label: "D", content: "Với tốc độ cao" });
    expect(q(8).answer).toEqual(["D"]);
    // 1 per row, wrapped option and a fifth option E
    expect(q(49).options).toHaveLength(5);
    expect(q(49).answer).toEqual(["E"]);
    expect(q(49).options[4].content).toMatch(/các bó cơ giảm, mất nhiều muối và nước rối loạn trao đổi chất trong cơ$/);
  });

  it("joins wrapped options and fractions, and ignores the closing 'HẾT'", () => {
    const q26 = r.questions[25];
    expect(q26.answer).toEqual(["A"]);
    expect(q26.options[0].content).toBe(
      "Đưa người ta vào chỗ thoáng mát, nới lỏng quần áo ra. Dùng khăn ướt lau người và đầu chân, cho uống dung dịch ozeron. Nếu nặng nữa nhanh chóng đưa đi bệnh viện",
    );
    const q78 = r.questions[77];
    expect(q78.answer).toEqual(["C"]);
    expect(q78.options[2].content).toBe("Tay phải đặt chéo lên tay trái ở 1/3 dưới xương ức");
    expect(q78.options[4].content).toBe("Tay trái đặt chéo lên tay phải đặt ở 1/2 tại xương ức");
  });

  it("marks fill-in-the-blank gaps in the stem", () => {
    expect(r.questions[69].stem).toBe(
      "Khi kiểm tra chức năng Hệ tim mạch trong vận động mới đánh giá được chức năng tim mạch có đáp ứng được nhu cầu cung cấp _____ cho hoạt động hay không?",
    );
  });

  it("reports missing answers when the PDF has no highlights", () => {
    const none = parsePdfItems(FIXTURE.items, []);
    expect(none.questions).toHaveLength(78);
    expect(none.summary.missing).toBe(78);
    expect(none.summary.keyFound).toBe(false);
    expect(none.warnings).toContainEqual(expect.objectContaining({ code: "NO_ANSWER_KEY" }));
  });

  it("does not split options on out-of-sequence labels", () => {
    const item = (x: number, y: number, str: string): Item => ({ page: 1, str, x, y, w: str.length * 5, h: 10 });
    const items = [
      item(34, 10, "Câu 1: Chọn vitamin?"),
      item(34, 30, "A."), item(52, 30, "Vitamin"), item(120, 30, "C."), item(140, 30, "là tốt"),
      item(34, 50, "B."), item(52, 50, "Không"),
      item(34, 70, "Câu 2: Hai?"),
      item(34, 90, "A."), item(52, 90, "Có"), item(306, 90, "B."), item(323, 90, "Không"),
    ];
    const res = parsePdfItems(items, [{ page: 1, x0: 300, y0: 88, x1: 360, y1: 102 }]);
    expect(res.questions[0].options).toEqual([
      { label: "A", content: "Vitamin C. là tốt" },
      { label: "B", content: "Không" },
    ]);
    expect(res.questions[0].status).toBe("missing");
    expect(res.questions[1].answer).toEqual(["B"]);
  });
});

describe("extractPdf on LTTDTT.pdf", () => {
  it("finds one highlight box per question", async () => {
    const { items, highlights } = await extractPdf(new Uint8Array(readFileSync("tests/fixtures/pdf/LTTDTT.pdf")));
    expect(items.length).toBeGreaterThan(500);
    expect(highlights).toHaveLength(78);
  });

  it("classifies highlighter colours", () => {
    expect(isHighlightColor("#ffeb3d")).toBe(true);
    expect(isHighlightColor("#ffff00")).toBe(true);
    expect(isHighlightColor("#000000")).toBe(false);
    expect(isHighlightColor("#ffffff")).toBe(false);
    expect(isHighlightColor("#6a1b9a")).toBe(false);
  });
});
