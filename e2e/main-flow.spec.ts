/**
 * SRD §9 end-to-end scenario:
 *  1 admin uploads a PDF → 2 questions extracted → 3 missing answers identified →
 *  4 admin requests AI suggestions → 5 admin verifies → 6 admin publishes →
 *  7 student starts → 8 completes → 9 system grades → 10 student reviews results.
 * (The timeout variant of step 8 is covered in exam.spec.ts.)
 */
import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { adminDb, createUser, PASSWORD, resetDb } from "../tests/integration/helpers";

config({ path: ".env.local", quiet: true });

const MISSING = [3, 9, 17, 30, 42];

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.beforeEach(async () => {
  await resetDb();
  const db = adminDb();
  const { data } = await db.storage.from("imports").list("", { limit: 1000 });
  if (data?.length) await db.storage.from("imports").remove(data.map((f) => f.name));
  await createUser("admin@e2e.test", "admin", "Quản trị E2E");
  await createUser("student@e2e.test", "student", "Học viên E2E");
  await db.from("subjects").insert({ name: "Pháp luật đại cương" });
});

test("PDF import → AI fallback → verify → publish → exam → results", async ({ page, browser }) => {
  test.setTimeout(120_000);

  // 1–2. Upload and extract
  await login(page, "admin@e2e.test");
  await page.goto("/admin/imports/new");
  await page.getByLabel("File PDF (tối đa 10 MB)").setInputFiles("tests/fixtures/pdf/PLDC1.pdf");
  await page.getByRole("button", { name: "Tải lên & phân tích" }).click();
  await page.waitForURL(/\/admin\/quizzes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const quizId = page.url().split("/").pop()!;
  await expect(page.getByText("Tổng", { exact: true }).locator("..")).toContainText("42");

  // 3. Simulate a PDF whose key lacks five entries. The parser's partial-key handling is
  //    unit-tested on the real fixture; here we only need unresolved questions in the UI.
  const db = adminDb();
  const { data: rows } = await db.from("questions").select("id, source_number").eq("quiz_id", quizId).in("source_number", MISSING);
  const ids = rows!.map((r) => r.id);
  await db.from("question_options").update({ is_correct: false }).in("question_id", ids);
  await db.from("questions").update({ answer_status: "missing", answer_source: null }).in("id", ids);
  await page.reload();
  await expect(page.getByText("Cần xử lý", { exact: true }).first().locator("..")).toContainText("5");
  await expect(page.getByText("Thiếu đáp án")).toHaveCount(5);

  // 4. AI only for the five unresolved questions (count shown before sending)
  await page.getByRole("button", { name: "Hỏi AI (5 câu)" }).click();
  await expect(page.getByRole("dialog")).toContainText("Gửi 5 câu tới AI (stub-model)");
  await page.getByRole("dialog").getByRole("button", { name: "Gửi cho AI" }).click();
  await expect(page.getByText("Đã áp dụng 5 · từ bộ nhớ đệm 0 · bị từ chối 0")).toBeVisible();
  await expect(page.getByText("AI gợi ý", { exact: true }).first()).toBeVisible();

  // Publishing is blocked until AI answers are confirmed
  await page.getByRole("button", { name: "Xuất bản" }).click();
  await expect(page.getByText("Đáp án chưa được xác nhận.").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // 5. Verify everything
  await page.getByLabel("Chọn tất cả").check();
  await page.getByRole("button", { name: /Xác nhận đã chọn \(42\)/ }).click();
  await expect(page.getByText("Đã xác nhận 42 câu")).toBeVisible();

  // 6. Publish
  await page.getByRole("button", { name: "Xuất bản" }).click();
  await expect(page.getByText("Đã xuất bản phiên bản 1")).toBeVisible();

  // 7–8. Student takes the exam
  const student = await (await browser.newContext()).newPage();
  await login(student, "student@e2e.test");
  await student.getByText("Pháp luật đại cương 01").click();
  await student.getByRole("button", { name: "Làm bài" }).click();
  await student.getByRole("dialog").getByRole("button", { name: "Bắt đầu" }).click();
  await student.waitForURL(/\/attempts\/[0-9a-f-]{36}$/);
  // Q1 correct (B = "Khoa học pháp lý cơ bản"), Q2 wrong
  await student.locator("#question-1").getByLabel("Khoa học pháp lý cơ bản").check();
  await student.locator("#question-2").getByRole("radio").first().check();
  await expect(student.getByText("Đã lưu").first()).toBeVisible();
  await student.getByRole("button", { name: "Nộp bài" }).first().click();
  await expect(student.getByRole("dialog")).toContainText("Bạn còn 40 câu chưa làm");
  await student.getByRole("dialog").getByRole("button", { name: "Nộp bài" }).click();

  // 9–10. Graded and reviewed: 1/42 × 10 = 0.2381 → "0,24"
  await student.waitForURL(/\/result$/);
  await expect(student.getByText("0,24")).toBeVisible();
  await expect(student.getByText("1 đúng")).toBeVisible();
  await expect(student.getByText("1 sai")).toBeVisible();
  await expect(student.getByText("40 chưa làm")).toBeVisible();

  // History lists the attempt and links back to the wrong answers
  await student.goto("/history");
  await expect(student.getByRole("cell", { name: "Pháp luật đại cương 01" })).toBeVisible();
  await student.getByRole("link", { name: "Câu sai" }).click();
  await expect(student.locator("fieldset")).toHaveCount(1);

  // Library card shows best/latest score
  await student.goto("/quizzes");
  await expect(student.getByText("Cao nhất: 0,24 · Gần nhất: 0,24")).toBeVisible();

  // Admin sees the attempt
  await page.goto("/admin/attempts");
  await expect(page.getByRole("cell", { name: "Học viên E2E" })).toBeVisible();
});
