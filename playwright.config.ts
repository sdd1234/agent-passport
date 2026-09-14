import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./eval/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
  },
  reporter: "list",
});
