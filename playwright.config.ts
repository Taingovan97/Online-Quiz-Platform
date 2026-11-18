import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "vi-VN",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    {
      command: "node e2e/ai-stub.mjs",
      url: "http://localhost:4010/health",
      reuseExistingServer: true,
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // The app talks to the local AI stub, never to a real (paid) provider.
      env: {
        AI_PROVIDER: "openai-compatible",
        AI_API_KEY: "stub",
        AI_MODEL: "stub-model",
        AI_BASE_URL: "http://localhost:4010/v1",
      },
    },
  ],
});
