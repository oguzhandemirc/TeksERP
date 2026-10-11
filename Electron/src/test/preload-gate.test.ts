import { afterEach, describe, expect, it, vi } from "vitest";
import { appEntryArgument } from "@shared/app-origin";

// =============================================================================
// PRELOAD KÖPRÜ KAPISI (güvenlik denetimi 2026-10-01, IST-5 — "preload kökene bakmıyor").
// İddia: `window.api` YALNIZ uygulamanın kendi belgesine açılır; splash, ağ paylaşımından
// yüklenmiş sayfa ya da giriş adresi bilinmeyen belge köprüyü ALMAZ. Gerçek
// `electron/preload.ts` her senaryoda yeniden yüklenir (konum + argv sahteleriyle).
// =============================================================================

const h = vi.hoisted(() => ({ expose: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: h.expose },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));

const ENTRY = "file:///Applications/TeksERP.app/Contents/Resources/app.asar/out/renderer/index.html";
const SPLASH = "file:///Applications/TeksERP.app/Contents/Resources/splash.html";

async function loadPreloadAt(href: string, argv: string[]): Promise<unknown[][]> {
  vi.resetModules();
  h.expose.mockClear();
  vi.stubGlobal("window", { location: { href } });
  const savedArgv = process.argv;
  process.argv = argv;
  try {
    await import("../../electron/preload");
  } finally {
    process.argv = savedArgv;
  }
  return h.expose.mock.calls;
}

const withEntry = ["electron", "--type=renderer", appEntryArgument(ENTRY)];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preload köprüsü yalnız uygulama belgesine", () => {
  it("uygulama belgesi `window.api`yi alır (bütün alanlarıyla)", async () => {
    const calls = await loadPreloadAt(`${ENTRY}#/giris`, withEntry);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("api");
    const api = calls[0]?.[1] as Record<string, unknown>;
    for (const key of ["secureStore", "discovery", "appInfo", "window", "system", "printer", "pdf", "files", "updater", "license", "tvWindow", "loomAlarm"]) {
      expect(api[key], key).toBeDefined();
    }
  });

  it("⭐ TV penceresi köprüsü ana sürece yalnız ekran kimliğini geçirir (adres/ek alan düşer)", async () => {
    const calls = await loadPreloadAt(`${ENTRY}#/giris`, withEntry);
    const api = calls[0]?.[1] as { tvWindow: { open: (r: unknown) => unknown } };
    const { ipcRenderer } = await import("electron");
    api.tvWindow.open({ displayId: 2, url: "https://saldirgan.example/" });
    expect(vi.mocked(ipcRenderer.invoke)).toHaveBeenLastCalledWith("tv-window:open", { displayId: 2 });
  });

  it("⭐ alarm bildirimi köprüsü yalnız kimlik + düz metin geçirir (adres/ek alan düşer)", async () => {
    const calls = await loadPreloadAt(`${ENTRY}#/giris`, withEntry);
    const api = calls[0]?.[1] as { loomAlarm: { notify: (r: unknown) => unknown; onOpen: (cb: (id: string) => void) => () => void } };
    const { ipcRenderer } = await import("electron");
    api.loomAlarm.notify({ alarmId: "a", title: "t", body: "b", url: "https://saldirgan.example/" });
    expect(vi.mocked(ipcRenderer.invoke)).toHaveBeenLastCalledWith("loom-alarm:notify", { alarmId: "a", title: "t", body: "b" });
  });

  it("⭐ NEGATİF: ana süreçten gelen açma olayı kimlik değilse çağıran HİÇ tetiklenmez", async () => {
    const calls = await loadPreloadAt(`${ENTRY}#/giris`, withEntry);
    const api = calls[0]?.[1] as { loomAlarm: { onOpen: (cb: (id: string) => void) => () => void } };
    const { ipcRenderer } = await import("electron");
    const cb = vi.fn();
    api.loomAlarm.onOpen(cb);
    const listener = vi.mocked(ipcRenderer.on).mock.calls.filter((c) => c[0] === "loom-alarm:open").at(-1)?.[1] as (e: unknown, p: unknown) => void;
    listener({}, { alarmId: "https://saldirgan.example/" });
    listener({}, { alarmId: "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b", url: "https://x" });
    expect(cb).not.toHaveBeenCalled();
    listener({}, { alarmId: "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b" });
    expect(cb).toHaveBeenCalledWith("3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b");
  });

  it("⭐ splash, ağ paylaşımı ve başka yerel sayfa köprüyü ALMAZ", async () => {
    for (const href of [SPLASH, "file://saldirgan/pay/out/renderer/index.html", "file:///Users/Shared/x/out/renderer/index.html", "https://saldirgan.com/"]) {
      expect(await loadPreloadAt(href, withEntry), href).toHaveLength(0);
    }
  });

  it("giriş adresi bayrağı yoksa köprü HİÇ açılmaz (fail-closed)", async () => {
    expect(await loadPreloadAt(`${ENTRY}#/`, ["electron", "--type=renderer"])).toHaveLength(0);
  });
});
