import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

/** One positioned run of text. y grows downward (top of page = 0). Coordinates in PDF points. */
export type Item = { page: number; str: string; x: number; y: number; w: number; h: number };

/** A filled highlight-coloured rectangle, same coordinate system as Item (top-left origin). */
export type Highlight = { page: number; x0: number; y0: number; x1: number; y1: number };

export type ExtractedPdf = { items: Item[]; highlights: Highlight[] };

type TextItem = { str: string; transform: number[]; width: number; height: number };
type Matrix = [number, number, number, number, number, number];

/** Extracts all non-blank text items (NFC) and highlight rectangles with positions. */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  const { OPS } = await getResolvedPDFJS();
  const pdf = await getDocumentProxy(bytes);
  const items: Item[] = [];
  const highlights: Highlight[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const raw of content.items as TextItem[]) {
      if (typeof raw.str !== "string") continue;
      const str = raw.str.normalize("NFC");
      if (!str.trim()) continue;
      const [, , , , x, yBase] = raw.transform;
      const h = raw.height || Math.abs(raw.transform[3]) || 10;
      items.push({
        page: p,
        str,
        x: round(x),
        y: round(height - yBase - h), // top edge, downward
        w: round(raw.width),
        h: round(h),
      });
    }
    const ops = await page.getOperatorList();
    highlights.push(...findHighlights(ops.fnArray, ops.argsArray, OPS, p, height));
  }
  return { items, highlights };
}

/** Text items only (kept for fixture tooling). */
export async function extractItems(bytes: Uint8Array): Promise<Item[]> {
  return (await extractPdf(bytes)).items;
}

/**
 * Walks the operator list tracking the transform stack and fill colour, and keeps
 * filled paths painted in a highlighter colour (yellow/amber family). These mark the
 * correct option in "highlighted answer" PDFs.
 */
function findHighlights(
  fnArray: number[],
  argsArray: unknown[],
  OPS: Record<string, number>,
  page: number,
  pageHeight: number,
): Highlight[] {
  const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const out: Highlight[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let fill = "#000000";
  const stack: { ctm: Matrix; fill: string }[] = [];

  fnArray.forEach((fn, i) => {
    const args = argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push({ ctm, fill });
    else if (fn === OPS.restore) ({ ctm, fill } = stack.pop() ?? { ctm, fill });
    else if (fn === OPS.transform && args) ctm = multiply(ctm, args as Matrix);
    else if (fn === OPS.setFillRGBColor && args) fill = toHex(args);
    else if (fn === OPS.constructPath && args && fillOps.has(args[0] as number) && isHighlightColor(fill)) {
      const mm = args[2] as ArrayLike<number> | null;
      if (!mm || mm.length < 4) return;
      const corners = [
        [mm[0], mm[1]],
        [mm[2], mm[1]],
        [mm[0], mm[3]],
        [mm[2], mm[3]],
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => pageHeight - c[1]);
      const box = { page, x0: round(Math.min(...xs)), y0: round(Math.min(...ys)), x1: round(Math.max(...xs)), y1: round(Math.max(...ys)) };
      // Ignore lines/underlines and full-page backgrounds.
      if (box.y1 - box.y0 >= 4 && box.x1 - box.x0 >= 4 && box.y1 - box.y0 < pageHeight / 2) out.push(box);
    }
  });
  return out;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function toHex(args: unknown[]): string {
  if (typeof args[0] === "string") return args[0];
  const [r, g, b] = args.map((v) => Math.round(Number(v) * (Number(v) <= 1 ? 255 : 1)));
  return "#" + [r, g, b].map((v) => (v || 0).toString(16).padStart(2, "0")).join("");
}

/** Yellow / amber highlighter colours: strong red and green, little blue. */
export function isHighlightColor(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return r >= 200 && g >= 160 && b <= 170 && r - b >= 80 && g - b >= 60;
}

const round = (n: number) => Math.round(n * 100) / 100;
