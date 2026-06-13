import { defineConfig } from "@playwright/test";

// Electron E2E — uygulama testin İÇİNDE `_electron.launch` ile başlatılır
// (webServer/browser project YOK; tarayıcı binary'si gerekmez). Önce
// `electron-vite build` ile out/ üretilmeli (npm run e2e bunu yapar).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    trace: "off",
  },
});
