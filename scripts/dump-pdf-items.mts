/**
 * Dumps the positioned text items (and highlight boxes, if any) of a PDF as JSON,
 * used to build parser test fixtures:
 *   npx tsx scripts/dump-pdf-items.mts tests/fixtures/pdf/PLDC1.pdf > tests/fixtures/pdf/PLDC1.items.json
 *   npx tsx scripts/dump-pdf-items.mts file.pdf --with-highlights > file.pdf.json   # { items, highlights }
 */
import { readFile } from "node:fs/promises";
import { extractPdf } from "../src/lib/pdf-import/extract";

const [path, flag] = process.argv.slice(2);
if (!path) {
  console.error("Usage: tsx scripts/dump-pdf-items.mts <file.pdf> [--with-highlights]");
  process.exitCode = 1;
} else {
  const { items, highlights } = await extractPdf(new Uint8Array(await readFile(path)));
  const out = flag === "--with-highlights" ? { items, highlights } : items;
  process.stdout.write(JSON.stringify(out, null, 1) + "\n");
}
