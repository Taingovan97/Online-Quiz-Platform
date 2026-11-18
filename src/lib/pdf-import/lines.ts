import type { Item } from "./extract";

export type Line = { page: number; y: number; items: Item[] };

/** Groups items into visual lines (same page, |Δy| ≤ tolerance) ordered top-to-bottom, left-to-right. */
export function buildLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const heights = sorted.map((i) => i.h).sort((a, b) => a - b);
  const tolerance = Math.max(1, 0.5 * (heights[Math.floor(heights.length / 2)] ?? 10));

  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && last.page === item.page && Math.abs(item.y - last.y) <= tolerance) {
      last.items.push(item);
    } else {
      lines.push({ page: item.page, y: item.y, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Joins items left-to-right. PDFs split words around Vietnamese diacritics, so
 * touching items (gap ≤ 1pt) are concatenated and wider gaps become one space.
 */
export function joinItems(items: Item[]): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const item of items) {
    if (prevEnd !== null && item.x - prevEnd > 1 && !out.endsWith(" ") && !item.str.startsWith(" ")) {
      out += " ";
    }
    out += item.str;
    prevEnd = item.x + item.w;
  }
  // After NFC every Vietnamese letter is precomposed; leftover combining marks are
  // duplicates produced by the PDF (e.g. "thuế" + U+0301) and are dropped.
  return out.normalize("NFC").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim();
}
