import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";

// E2E smoke — uygulama gerçekten açılıyor mu + ilk ekran (Login) render oluyor mu?
// Backend GEREKMEZ: login ekranı API çağırmadan render olur (giriş submit'e kadar).
// Bu, E2E iskeletinin çalıştığını kanıtlar; backend'li tam akış (login→navigasyon)
// buradan genişletilir (backend + seed ayağa kaldırılıp form doldurulur).

let app: ElectronApplication;

test.afterEach(async () => {
  await app?.close();
});

test("uygulama açılır ve Login ekranı render olur", async () => {
  // package.json "main" → out/main/main.js (electron-vite build çıktısı).
  app = await electron.launch({ args: ["."] });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  // Marka + giriş alanları görünür olmalı.
  await expect(win.getByText("TeksERP").first()).toBeVisible({ timeout: 20_000 });
  await expect(win.getByPlaceholder("ör. admin")).toBeVisible();
});
