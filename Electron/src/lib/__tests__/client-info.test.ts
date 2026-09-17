// =============================================================================
// BEKÇİ — `X-Client-Version` başlığı: login İLK istektir, sürümsüz gitmesin (rol modeli faz 2, kaldırma kapısı ④)
// =============================================================================
// `Session.clientVersion` oturum açılırken damgalanır; sürüm main process'ten ASENKRON okunduğu için ilk istek
// sürümsüz gidebiliyordu (panel sahada hep NULL görünürdü → kaldırma fazı web/electron'u ölçemezdi).
// §1 Electron: sürüm `VERSION_WAIT_MS` içinde gelirse İLK istekte başlıkta (vakum: boş değil, semver deseni)
// §2 Electron: süre dolarsa istek BAŞLIKSIZ ama düşmez; sürüm gelince SONRAKİ istek başlıklı (sunucu doldurur)
// §3 web build: `window.api` yok, `__APP_VERSION__` (Vite define) başlıkta; boş define → başlık yok (vakum değil)
// Negatif sonda (kırmızı görüldü): `applyClientInfoHeaders`teki `Promise.race` beklemesi kaldırılınca §1 ❌
// (ilk istek sürümsüz); `WEB_VERSION` kaynağı `null`a sabitlenince §3 ❌.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const durum = { electron: true };
vi.mock("@/lib/deviceId", () => ({ getOrCreateDeviceId: async () => "cihaz-1" }));

const SEMVER = /^\d+\.\d+\.\d+/;
type Set = Record<string, string>;
const g = globalThis as unknown as { __APP_VERSION__?: string };

function kurWindowApi(gecikmeMs: number | null, surum = "1.3.1"): void {
  const api = gecikmeMs === null ? undefined : { appInfo: { version: () => new Promise<string>((r) => setTimeout(() => r(surum), gecikmeMs)) } };
  Object.defineProperty(window, "api", { value: api, configurable: true, writable: true });
}
/** Modül düzeyi önbellek (`versionCache`) her senaryoda sıfırdan; kip bayrağı o anki `durum`dan (doMock hoist edilmez). */
async function yukle() {
  vi.resetModules();
  vi.doMock("@/lib/runtime-env", () => ({ IS_ELECTRON: durum.electron }));
  return import("@/lib/client-info");
}
async function istek(apply: (set: (n: string, v: string) => void) => Promise<void>): Promise<{ h: Set; ms: number }> {
  const h: Set = {};
  const t0 = Date.now();
  await apply((n, v) => {
    h[n] = v;
  });
  return { h, ms: Date.now() - t0 };
}

beforeEach(() => {
  durum.electron = true;
  delete g.__APP_VERSION__;
});
afterEach(() => kurWindowApi(null));

describe("client-info — X-Client-Version", () => {
  it("⭐ §1 Electron: sürüm 300 ms içinde gelirse İLK istek başlıklı (boş değil, semver)", async () => {
    kurWindowApi(80);
    const m = await yukle();
    const { h, ms } = await istek(m.applyClientInfoHeaders);
    expect(h[m.CLIENT_INFO_HEADERS.version]).toBe("1.3.1");
    expect(h[m.CLIENT_INFO_HEADERS.version]).toMatch(SEMVER);
    expect(h[m.CLIENT_INFO_HEADERS.kind]).toBe("electron");
    expect(h[m.CLIENT_INFO_HEADERS.instance]).toBe("cihaz-1");
    expect(ms).toBeLessThan(m.VERSION_WAIT_MS);
  });

  it("⭐ §2 Electron: süre dolarsa istek BAŞLIKSIZ ama düşmez (≈300 ms); sürüm gelince sonraki istek başlıklı", async () => {
    kurWindowApi(600);
    const m = await yukle();
    const ilk = await istek(m.applyClientInfoHeaders);
    expect(ilk.h[m.CLIENT_INFO_HEADERS.version]).toBeUndefined();
    expect(ilk.h[m.CLIENT_INFO_HEADERS.kind]).toBe("electron");
    expect(ilk.ms).toBeGreaterThanOrEqual(m.VERSION_WAIT_MS - 20);
    expect(ilk.ms).toBeLessThan(600);
    await new Promise((r) => setTimeout(r, 400));
    const sonra = await istek(m.applyClientInfoHeaders);
    expect(sonra.h[m.CLIENT_INFO_HEADERS.version]).toBe("1.3.1");
    expect(sonra.ms).toBeLessThan(50);
  });

  it("⭐ §3 web build: `window.api` yok, `__APP_VERSION__` başlıkta; boş define → başlık yok", async () => {
    durum.electron = false;
    kurWindowApi(null);
    g.__APP_VERSION__ = "1.3.1";
    const m = await yukle();
    const { h, ms } = await istek(m.applyClientInfoHeaders);
    expect(h[m.CLIENT_INFO_HEADERS.kind]).toBe("web");
    expect(h[m.CLIENT_INFO_HEADERS.version]).toBe("1.3.1");
    expect(h[m.CLIENT_INFO_HEADERS.version]).toMatch(SEMVER);
    expect(ms).toBeLessThan(50);
    g.__APP_VERSION__ = "";
    const bos = await yukle();
    expect((await istek(bos.applyClientInfoHeaders)).h[bos.CLIENT_INFO_HEADERS.version]).toBeUndefined();
  });

  it("Electron'da main sürümü web define'ına baskın; sürüm okunamazsa (reddedildi) istek yine gider", async () => {
    g.__APP_VERSION__ = "9.9.9";
    kurWindowApi(10, "1.3.1");
    const m = await yukle();
    expect((await istek(m.applyClientInfoHeaders)).h[m.CLIENT_INFO_HEADERS.version]).toBe("1.3.1");
    Object.defineProperty(window, "api", { value: { appInfo: { version: () => Promise.reject(new Error("ipc yok")) } }, configurable: true, writable: true });
    const r = await yukle();
    const { h } = await istek(r.applyClientInfoHeaders);
    expect(h[r.CLIENT_INFO_HEADERS.version]).toBeUndefined();
    expect(h[r.CLIENT_INFO_HEADERS.kind]).toBe("electron");
  });
});
