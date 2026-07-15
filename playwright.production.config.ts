import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

const productionBaseUrl = `http://127.0.0.1:${process.env.AVL_PLAYWRIGHT_PORT ?? "4173"}`;

const chromiumProductionTests = [
  "**/m9-alpha-sizing.spec.ts",
  "**/m9-author-dimensions.spec.ts",
  "**/m9-capability-fallback.spec.ts",
  "**/m9-certification-harness.spec.ts",
  "**/m9-loader-lifecycle.spec.ts",
  "**/m9-production-engine-capability.spec.ts",
  "**/m9-public-element.spec.ts",
  "**/m9-resource-fault.spec.ts"
];

const crossEngineProductionTests = [
  "**/m9-capability-fallback.spec.ts",
  "**/m9-production-engine-capability.spec.ts"
];

export default defineConfig({
  ...base,
  testIgnore: [],
  timeout: 90_000,
  reporter: [["list"], ["json", { outputFile: "artifacts/browser/production-results.json" }]],
  webServer: {
    command: "node scripts/testing/serve-production-playground.mjs",
    url: productionBaseUrl,
    reuseExistingServer: false,
    timeout: 10 * 60_000
  },
  projects: [
    {
      name: "playwright-bundled-chromium-engine-production-probe",
      testMatch: chromiumProductionTests,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] }
      }
    },
    {
      name: "playwright-bundled-firefox-engine-production-probe",
      testMatch: crossEngineProductionTests,
      use: { ...devices["Desktop Firefox"] }
    },
    {
      name: "playwright-bundled-webkit-engine-production-probe",
      testMatch: crossEngineProductionTests,
      use: { ...devices["Desktop Safari"] }
    }
  ]
});
