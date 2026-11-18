import { config } from "dotenv";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createUser, PASSWORD, resetDb } from "../tests/integration/helpers";

config({ path: ".env.local", quiet: true });

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  return ctx.newPage();
}

test.beforeEach(async () => {
  await resetDb();
  await createUser("admin@e2e.test", "admin", "Quản trị E2E");
});

test("anonymous visitors are sent to login, which has no sign-up", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Tài khoản chỉ được tạo qua lời mời")).toBeVisible();
  await expect(page.getByRole("link", { name: /đăng ký/i })).toHaveCount(0);
});

test("wrong password shows an error", async ({ page }) => {
  await login(page, "admin@e2e.test", "wrong-password");
  await expect(page.locator("[data-slot=alert]")).toContainText("Email hoặc mật khẩu không đúng");
});

test("invite → accept → student access → deactivate", async ({ browser }) => {
  // Admin creates an invitation
  const admin = await newPage(browser);
  await login(admin, "admin@e2e.test");
  await expect(admin).toHaveURL(/\/admin$/);
  await admin.goto("/admin/users");
  await admin.getByRole("button", { name: "Mời người dùng" }).click();
  await admin.getByLabel("Email").fill("hocvien@e2e.test");
  await admin.getByRole("button", { name: "Tạo liên kết mời" }).click();
  const linkInput = admin.getByLabel("Liên kết mời");
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  await expect(admin.getByText("Hết hạn sau 72 giờ")).toBeVisible();

  // Invitee accepts
  const student = await newPage(browser);
  await student.goto(link);
  await expect(student.getByLabel("Email")).toHaveValue("hocvien@e2e.test");
  await student.getByLabel("Họ và tên").fill("Nguyễn Thị Học");
  await student.getByLabel("Mật khẩu (ít nhất 8 ký tự)").fill(PASSWORD);
  await student.getByLabel("Nhập lại mật khẩu").fill(PASSWORD);
  await student.getByRole("button", { name: "Kích hoạt" }).click();
  await expect(student).toHaveURL(/\/quizzes$/);

  // Student cannot reach admin pages
  await student.goto("/admin/users");
  await expect(student).toHaveURL(/\/quizzes$/);

  // The link is single-use
  const other = await newPage(browser);
  await other.goto(link);
  await expect(other.locator("[data-slot=alert]")).toContainText("Lời mời không hợp lệ");

  // Admin deactivates the student
  await admin.reload();
  await admin.keyboard.press("Escape");
  const toggle = admin.getByRole("switch", { name: "Hoạt động: Nguyễn Thị Học" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(admin.getByText("Đã vô hiệu hoá tài khoản")).toBeVisible();

  // Student's next request ends the session
  await student.goto("/quizzes");
  await expect(student).toHaveURL(/\/login\?reason=inactive$/);
  await expect(student.locator("[data-slot=alert]")).toContainText("vô hiệu hoá");
});
