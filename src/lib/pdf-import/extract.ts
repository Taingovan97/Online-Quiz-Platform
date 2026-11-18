import { getDocumentProxy } from "unpdf";

/** One positioned run of text. y grows downward (top of page = 0). Coordinates in PDF points. */
export type Item = { page: number; str: string; x: number; y: number; w: number; h: number };

type TextItem = { str: string; transform: number[]; width: number; height: number };

/** Extracts all non-blank text items with positions, normalized to Unicode NFC. */
export async function extractItems(bytes: Uint8Array): Promise<Item[]> {
  const pdf = await getDocumentProxy(bytes);
  const items: Item[] = [];
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
    }
  return items;
}

const round = (n: number) => Math.round(n * 100) / 100;
