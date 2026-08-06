import { test, _electron as electron, type ElectronApplication } from "@playwright/test";

let app: ElectronApplication;
test.afterEach(async () => {
  await app?.close();
});

test("probe", async () => {
  app = await electron.launch({ args: ["."] });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(3000);

  const user = win.locator("#username");
  if (await user.isVisible().catch(() => false)) {
    await user.fill("TEST-ADMIN");
    await win.locator("#password").fill("TestAdmin2026!");
    await win.getByRole("button", { name: "Giriş Yap" }).click();
  }
  // Açılış animasyonu var — sabit timeout yetmiyor; kabuk gelene kadar bekle.
  await win.waitForFunction(
    () => window.location.hash.startsWith("#/") && !window.location.hash.includes("login"),
    undefined,
    { timeout: 90_000 },
  );
  await win.waitForTimeout(2500);
  await win.screenshot({ path: "test-results/p1-after-login.png" });
  console.log("HASH after login:", await win.evaluate(() => window.location.hash));

  await win.keyboard.press("Meta+k");
  await win.waitForTimeout(800);
  await win.screenshot({ path: "test-results/p2-palette.png" });
  await win.keyboard.type("Toplar", { delay: 40 });
  await win.waitForTimeout(1200);
  await win.screenshot({ path: "test-results/p3-typed.png" });
  const opts = await win.getByRole("option").allInnerTexts();
  console.log("PALETTE OPTIONS:", JSON.stringify(opts.slice(0, 15)));
  await win.keyboard.press("Enter");
  await win.waitForTimeout(4000);
  await win.screenshot({ path: "test-results/p4-screen.png" });
  console.log("HASH after nav:", await win.evaluate(() => window.location.hash));
  const btns = await win.getByRole("button").allInnerTexts();
  console.log("BUTTONS:", JSON.stringify(btns.filter(Boolean).slice(0, 50)));
});
