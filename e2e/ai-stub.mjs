// Minimal OpenAI-compatible Chat Completions stub for browser tests (no network, no cost).
// Answers every question with its first option ("A"), or "A"+"B" for multiple-answer questions.
import { createServer } from "node:http";

const port = Number(process.env.AI_STUB_PORT ?? 4010);

createServer((req, res) => {
  if (req.method === "GET") return res.end("ok");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const request = JSON.parse(body);
    const user = request.messages.find((m) => m.role === "user").content;
    const json = user.slice(user.indexOf("["), user.lastIndexOf("]") + 1);
    const answers = JSON.parse(json).map((q) => ({
      ref: q.ref,
      labels: q.selectionType === "multiple" ? ["A", "B"] : ["A"],
      explanation: "Gợi ý từ AI (stub).",
      confidence: "medium",
    }));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answers }) } }] }));
  });
}).listen(port, () => console.log(`AI stub on :${port}`));
