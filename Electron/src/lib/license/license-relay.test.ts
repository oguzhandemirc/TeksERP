import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateRelayBody, validateRelayTarget, LICENSE_RELAY_MAX_RESPONSE_BYTES } from "@shared/license-relay";

// Main süreç işleyicisi: `electron` yalnız `ipcMain` + `net.fetch` için gerekir.
const fetchMock = vi.fn();
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, net: { fetch: (...a: unknown[]) => fetchMock(...a) } }));
const { relayLicenseRequest } = await import("../../../electron/ipc/license.ipc");

const ZARF = "eyJ2IjoxLCJpc3RlayI6ImEiLCJnb3ZkZSI6ImIifQ";
const BODY = { v: 1, zarf: ZARF } as const;
const TARGET = "https://lisans.example.com/v1/cevrimdisi";

/**
 * PANEL AKTARMASI — main süreç rastgele bir POST vekili OLMAMALI: hedef yalnız
 * satıcının çevrimdışı ucu, gövde yalnız `{ v: 1, zarf }`, yanıt tavanlı.
 */
describe("aktarma hedefi ve gövdesi (saf)", () => {
  it("https + /v1/cevrimdisi kabul; döngü adresinde http kabul", () => {
    expect(validateRelayTarget(TARGET)).toBe(TARGET);
    expect(validateRelayTarget("http://localhost:4471/v1/cevrimdisi")).not.toBeNull();
  });

  it.each([
    ["uzak http", "http://lisans.example.com/v1/cevrimdisi"],
    ["başka yol", "https://lisans.example.com/v1/yokla"],
    ["kimlik bilgili", "https://a:b@lisans.example.com/v1/cevrimdisi"],
    ["sorgulu", "https://lisans.example.com/v1/cevrimdisi?x=1"],
    ["dosya", "file:///etc/passwd"],
    ["metin değil", 42],
  ])("RED: %s", (_ad, raw) => {
    expect(validateRelayTarget(raw)).toBeNull();
  });

  it("gövde tam olarak {v:1, zarf}", () => {
    expect(validateRelayBody(BODY)).toEqual(BODY);
    expect(validateRelayBody({ ...BODY, ek: 1 })).toBeNull();
    expect(validateRelayBody({ v: 2, zarf: ZARF })).toBeNull();
    expect(validateRelayBody({ v: 1, zarf: "a b" })).toBeNull();
    expect(validateRelayBody({ v: 1, zarf: "" })).toBeNull();
    expect(validateRelayBody([BODY])).toBeNull();
  });
});

describe("relayLicenseRequest (main)", () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.useRealTimers());

  it("geçersiz hedefte ağa HİÇ çıkmaz", async () => {
    expect(await relayLicenseRequest("https://kotu.example.com/v1/yokla", BODY)).toEqual({ ok: false, kod: "HEDEF_GECERSIZ" });
    expect(await relayLicenseRequest(TARGET, { ...BODY, ek: true })).toEqual({ ok: false, kod: "GOVDE_GECERSIZ" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gövdeyi AYNEN POST eder, JSON yanıtı ve durumu döner; yönlendirme izlenmez", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ kira: "x" }), { status: 200 }));
    const r = await relayLicenseRequest(TARGET, BODY);
    expect(r).toEqual({ ok: true, status: 200, yanit: { kira: "x" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TARGET);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(BODY);
    expect(init.redirect).toBe("error");
  });

  it("satıcı hata gövdesi de yanıt olarak döner (durum kodu ile)", async () => {
    const err = { success: false, message: "Kod kullanılmış.", details: { code: "ETKINLESTIRME_KODU_KULLANILMIS" } };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(err), { status: 409 }));
    expect(await relayLicenseRequest(TARGET, BODY)).toEqual({ ok: true, status: 409, yanit: err });
  });

  it("tavanı aşan yanıt kesilir; JSON olmayan yanıt reddedilir; ağ hatası adlandırılır", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(LICENSE_RELAY_MAX_RESPONSE_BYTES + 10), { status: 200 }));
    expect(await relayLicenseRequest(TARGET, BODY)).toMatchObject({ ok: false, kod: "YANIT_BUYUK" });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    expect(await relayLicenseRequest(TARGET, BODY)).toMatchObject({ ok: false, kod: "YANIT_JSON_DEGIL", status: 502 });
    fetchMock.mockRejectedValueOnce(new TypeError("net::ERR_NAME_NOT_RESOLVED"));
    expect(await relayLicenseRequest(TARGET, BODY)).toEqual({ ok: false, kod: "AG_HATASI" });
  });
});
