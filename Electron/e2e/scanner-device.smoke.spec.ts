import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";

// E2E smoke — Faz-2 seri/HID cihaz okuyucu IPC köprüsü gerçek Electron'da
// uçtan uca çalışıyor mu? Backend GEREKMEZ (login ekranında da window.api
// global), DONANIM GEREKMEZ (mock taşıma). list/open/status/mockEmit→onData
// round-trip'i doğrular — yani okutulan kodun renderer'a (pushScan'a) ulaştığını.

let app: ElectronApplication;

test.afterEach(async () => {
  await app?.close();
});

// Renderer context'te window.api.scanner için minimal tip (lint-temiz).
interface ScannerBridge {
  list: (t: string) => Promise<{ available: boolean; error: string | null; devices: unknown[] }>;
  open: (o: { transport: string; path: string; terminator: string }) => Promise<{ connected: boolean; transport: string | null }>;
  status: () => Promise<{ transport: string | null; connected: boolean }>;
  mockEmit: (c: string) => void;
  onData: (cb: (c: string) => void) => () => void;
}

test("scanner IPC köprüsü: list/open/status + mockEmit→onData round-trip", async () => {
  app = await electron.launch({ args: ["."] });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await expect(win.getByText("TeksERP").first()).toBeVisible({ timeout: 20_000 });

  const result = await win.evaluate(async () => {
    const s = (window as unknown as { api: { scanner: ScannerBridge } }).api.scanner;
    const list = await s.list("mock");
    const opened = await s.open({ transport: "mock", path: "mock", terminator: "lf" });
    const status = await s.status();
    const code = await new Promise<string>((resolve) => {
      const off = s.onData((c) => {
        off();
        resolve(c);
      });
      s.mockEmit("TEKS-20260615-AB12CD34");
      setTimeout(() => resolve("(timeout)"), 3000);
    });
    return { list, opened, status, code };
  });

  expect(result.list.available).toBe(true);
  expect(result.list.devices.length).toBeGreaterThan(0);
  expect(result.opened.connected).toBe(true);
  expect(result.status.transport).toBe("mock");
  expect(result.code).toBe("TEKS-20260615-AB12CD34");
});
