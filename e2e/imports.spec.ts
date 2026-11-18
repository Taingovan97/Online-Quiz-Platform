import { config } from "dotenv";
import { expect, test } from "@playwright/test";
import { adminDb, createUser, PASSWORD, resetDb } from "../tests/integration/helpers";

config({ path: ".env.local", quiet: true });

test.beforeEach(async () => {
  await resetDb();
  const db = adminDb();
  const { data } = await db.storage.from("imports").list("", { limit: 1000 });
  if (data?.length) await db.storage.from("imports").remove(data.map((f) => f.name));
  await createUser("admin@e2e.test", "admin", "Quản trị E2E");
  await db.from("subjects").insert({ name: "Pháp luật đại cương" });
});

test("admin imports PLDC1.pdf and reviews the extracted quiz", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@e2e.test");
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/admin$/);

  await page.goto("/admin/imports/new");
  await page.getByLabel("File PDF (tối đa 10 MB)").setInputFiles("tests/fixtures/pdf/PLDC1.pdf");
  await page.getByRole("button", { name: "Tải lên & phân tích" }).click();
  await page.waitForURL(/\/admin\/quizzes\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await expect(page.getByRole("heading", { name: "Pháp luật đại cương 01" })).toBeVisible();
  const total = page.getByText("Tổng", { exact: true }).locator("..");
  await expect(total).toContainText("42");

  // Letter-reference warning is shown on Q7 (sorted ahead of clean rows).
  await expect(page.getByText("⚠ C. Cả B và C")).toBeVisible();

  // No AI configured in this environment → no AI button.
  await expect(page.getByRole("button", { name: /Hỏi AI/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Xuất bản" }).click();
  await expect(page.getByText("Đã xuất bản phiên bản 1")).toBeVisible();
});
