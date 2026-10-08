import net from "node:net";
import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";

// E2E smoke — uygulama gerçekten açılıyor mu + giriş sayfası render oluyor mu?
// Giriş sayfası formu çizmeden önce varsayılan sunucuyu yoklar (useServerReachability):
// sunucu yoksa form YERİNE "Sunucuya ulaşılamadı" çizilir. CI'da backend yoktur,
// o yüzden beklenti yoklamanın kendi gözlemine göre kurulur — iki dal da gerçek iddiadır.

const VARSAYILAN_PORT = 4000; // DEFAULT_API_BASE_URL = http://localhost:4000 (VITE_API_BASE_URL yoksa)

function portAcikMi(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "localhost", port });
    s.setTimeout(1000);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("timeout", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(false));
  });
}

let app: ElectronApplication;

test.afterEach(async () => {
  await app?.close();
});

test("uygulama açılır ve giriş sayfası render olur (sunucu yoksa form yerine 'Sunucuya ulaşılamadı')", async () => {
  const sunucuVar = await portAcikMi(VARSAYILAN_PORT);
  // package.json "main" → out/main/main.js (electron-vite build çıktısı).
  app = await electron.launch({ args: ["."] });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  await expect(win.getByText("TeksERP").first()).toBeVisible({ timeout: 20_000 });
  if (sunucuVar) {
    await expect(win.getByPlaceholder("ör. admin")).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(win.getByRole("heading", { name: "Sunucuya ulaşılamadı" })).toBeVisible({ timeout: 10_000 });
    // Sunucusuz formu göstermek kullanıcıyı adını yanlış yazmakla suçlar — form gizli kalmalı.
    await expect(win.getByPlaceholder("ör. admin")).toHaveCount(0);
  }
});
