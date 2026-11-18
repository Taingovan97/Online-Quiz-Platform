import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { createUser, PASSWORD, resetDb } from "../tests/integration/helpers";
import { seedPublishedQuiz } from "./seed";

config({ path: ".env.local", quiet: true });

const QUESTIONS = [
  { content: "Nhà nước là một hiện tượng lịch sử - xã hội:", options: ["Bất biến", "Thay đổi theo quy luật khách quan", "Thay đổi theo ý chí", "Cả A và C"], correct: ["B"], explanation: "Nhà nước vận động theo quy luật khách quan." },
  { content: "Những thuộc tính nào là của pháp luật?", options: ["Tính quy phạm phổ biến", "Tính bất biến", "Tính cưỡng chế nhà nước", "Tính tự nguyện"], correct: ["A", "C"] },
  { content: "Nguồn sớm nhất hình thành pháp luật là", options: ["Tập quán pháp", "Tiền lệ pháp", "Văn bản pháp luật", "Học thuyết"], correct: ["A"] },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("student@e2e.test");
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/quizzes$/);
}

async function startQuiz(page: Page, title: string) {
  await page.getByText(title).click();
  await page.getByRole("button", { name: "Làm bài" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Bắt đầu" }).click();
  await page.waitForURL(/\/attempts\/[0-9a-f-]{36}$/);
}

const card = (page: Page, n: number) => page.locator(`#question-${n}`);

test.beforeEach(async () => {
  await resetDb();
  const adminId = await createUser("admin@e2e.test", "admin");
  await createUser("student@e2e.test", "student", "Học viên E2E");
  await seedPublishedQuiz({ adminId, title: "Đề 45 phút", subject: "Pháp luật", durationMinutes: 45, questions: QUESTIONS });
  await seedPublishedQuiz({ adminId, title: "Đề 1 phút", subject: "Pháp luật", durationMinutes: 1, questions: QUESTIONS });
});

test("take an exam: answer, resume after reload, submit, review", async ({ page }) => {
  await login(page);
  await startQuiz(page, "Đề 45 phút");

  await card(page, 1).getByLabel("Thay đổi theo quy luật khách quan").check();
  await card(page, 2).getByLabel("Tính quy phạm phổ biến").check();
  await expect(card(page, 2).getByText("Chọn một hoặc nhiều đáp án")).toBeVisible();
  await expect(page.getByText("Đã lưu").first()).toBeVisible();

  // Reload: answers come back from the server
  await page.reload();
  await expect(card(page, 1).getByLabel("Thay đổi theo quy luật khách quan")).toBeChecked();
  await expect(card(page, 2).getByLabel("Tính quy phạm phổ biến")).toBeChecked();

  const examUrl = page.url();

  // Submit with unanswered questions listed
  await page.getByRole("button", { name: "Nộp bài" }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Bạn còn 1 câu chưa làm (3).");
  await page.getByRole("dialog").getByRole("button", { name: "Nộp bài" }).click();
  await page.waitForURL(/\/result$/);

  // Q1 correct; Q2 missing C → wrong; Q3 unanswered → 1/3 × 10
  await expect(page.getByText("3,33")).toBeVisible();
  await expect(page.getByText("1 đúng")).toBeVisible();
  await expect(page.getByText("1 sai")).toBeVisible();
  await expect(page.getByText("1 chưa làm")).toBeVisible();
  await expect(page.getByText("Nhà nước vận động theo quy luật khách quan.")).toBeVisible();

  await page.getByRole("button", { name: "Câu sai" }).click();
  await expect(page.locator("fieldset")).toHaveCount(1);
  await expect(page.locator("fieldset")).toContainText("Những thuộc tính nào");

  // Going back to the exam URL shows the result instead
  await page.goto(examUrl);
  await expect(page).toHaveURL(/\/result$/);
});

test("the exam submits itself when time runs out", async ({ page }) => {
  await page.clock.install();
  await login(page);
  await startQuiz(page, "Đề 1 phút");
  await card(page, 3).getByLabel("Tập quán pháp").check();
  await expect(page.getByText("Đã lưu").first()).toBeVisible();

  await page.clock.fastForward("01:05");
  await page.waitForURL(/\/result$/, { timeout: 20_000 });
  await expect(page.getByText("Hết giờ (tự động nộp)")).toBeVisible();
  await expect(page.getByText("3,33")).toBeVisible();
});

test("mobile layout: sticky bar with timer, progress and question list", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page);
  await startQuiz(page, "Đề 45 phút");
  await card(page, 1).getByLabel("Bất biến").check();
  await expect(page.getByText("1/3")).toBeVisible();
  await page.getByRole("button", { name: "Danh sách câu" }).click();
  await page.getByRole("listitem", { name: /Câu 3/ }).click();
  await expect(card(page, 3)).toBeInViewport();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
});
