import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { createUser, PASSWORD, resetDb } from "../tests/integration/helpers";

config({ path: ".env.local", quiet: true });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.beforeEach(async () => {
  await resetDb();
  await createUser("admin@e2e.test", "admin", "Quản trị E2E");
  await createUser("student@e2e.test", "student", "Học viên E2E");
});

test("admin builds and publishes a quiz; student sees it", async ({ page, browser }) => {
  await login(page, "admin@e2e.test");

  // Subject
  await page.goto("/admin/subjects");
  await page.getByRole("button", { name: "Thêm môn học" }).click();
  await page.getByLabel("Tên môn học").fill("Pháp luật đại cương");
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByText("Đã lưu môn học")).toBeVisible();

  // Quiz
  await page.goto("/admin/quizzes");
  await page.getByRole("button", { name: "Tạo đề mới" }).click();
  await page.getByLabel("Tên đề").fill("Đề ôn tập 01");
  await page.getByRole("dialog").getByRole("button", { name: "Tạo đề mới" }).click();
  await page.waitForURL(/\/admin\/quizzes\/[0-9a-f-]{36}$/);

  // Publishing an empty quiz is blocked
  await page.getByRole("button", { name: "Xuất bản" }).click();
  await expect(page.getByText("Đề chưa có câu hỏi nào.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Add a question through the editor
  await page.getByRole("button", { name: "Thêm câu hỏi" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Nội dung câu hỏi").fill("Nhà nước là một hiện tượng lịch sử - xã hội:");
  for (const [label, text] of [["A", "Bất biến"], ["B", "Thay đổi theo quy luật khách quan"], ["C", "Thay đổi theo ý chí"], ["D", "Cả A và C"]]) {
    await sheet.getByLabel(`Phương án ${label}`).fill(text);
  }
  await sheet.getByRole("radio").nth(1).check();
  await sheet.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText("Đã lưu câu hỏi")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Câu 1")).toBeVisible();
  await expect(page.getByText("✓ B")).toBeVisible();

  // Preview shows the student view
  await page.getByRole("link", { name: "Xem trước" }).click();
  await expect(page.getByText("Thay đổi theo quy luật khách quan")).toBeVisible();

  // Publish
  await page.getByRole("link", { name: "Câu hỏi" }).click();
  await page.getByRole("button", { name: "Xuất bản" }).click();
  await expect(page.getByText("Đã xuất bản phiên bản 1")).toBeVisible();
  await expect(page.getByText("Đề đang được xuất bản nên không thể chỉnh sửa")).toBeVisible();

  // Student sees it in the library
  const student = await (await browser.newContext()).newPage();
  await login(student, "student@e2e.test");
  await expect(student).toHaveURL(/\/quizzes$/);
  await expect(student.getByText("Đề ôn tập 01")).toBeVisible();
  await expect(student.getByText("1 câu")).toBeVisible();
  await expect(student.getByText("Pháp luật đại cương")).toBeVisible();
});
