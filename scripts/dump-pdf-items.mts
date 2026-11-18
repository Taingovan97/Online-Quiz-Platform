/**
 * Dumps the positioned text items of a PDF as JSON (used to build test fixtures).
 *   npx tsx scripts/dump-pdf-items.mts tests/fixtures/pdf/PLDC1.pdf > tests/fixtures/pdf/PLDC1.items.json
 */
import { readFile } from "node:fs/promises";
import { extractItems } from "../src/lib/pdf-import/extract";

const path = process.argv[2];
if (!path) {
  console.error("Usage: tsx scripts/dump-pdf-items.mts <file.pdf>");
  process.exitCode = 1;
} else {
  const items = await extractItems(new Uint8Array(await readFile(path)));
  process.stdout.write(JSON.stringify(items, null, 1) + "\n");
}
