// Bekçi: bulut (internet kipi) adresi ana süreçte doğru yoklanır ve LAN sabiti yoluna girmez (2026-10-08 saha:
// panel 1.5.0 https://deneme.etkiliyazilim.com'a "test başarılı" dedi ama giriş ekranı "Sunucuya ulaşılamadı"da kaldı).
// ⭐ portsuz https = 443 (4000 DEĞİL) — ana süreçteki iki ayrıştırıcı tek kaynaktan.
// ⭐ internet kipi yoklaması sabit aramaz; zincir doğrulanır; kimliğin protocol/apiPort beyanı adresi değiştirmez.
// ⭐ ilansız sertifika (bulut kenarı / vekil) ve internet adı kodla SABİTLENMEZ — onay da sunulmaz.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERNET_HOST_NOT_PINNABLE_REASON,
  UNADVERTISED_CERT_REASON,
  checkPinRequest,
  serverUrlParts,
  type TlsPin,
} from "@shared/lan-tls";
import { planTlsSwitch } from "@/lib/lan-tls-ui";

const FP = "ab".repeat(32);
const EDGE = "ef".repeat(32);
const IID = "7028b502-d6ab-4998-869b-85472c3c4f3c";
const CLOUD = "https://deneme.etkiliyazilim.com";
/** Vekil arkasındaki sunucunun bugünkü (yanlış etiketli) kimlik yanıtı. */
const PROXIED_IDENTITY = { installationId: IID, protocol: "http", apiPort: 4000, version: "2.14.0" };

const probe = vi.fn();
const addTlsPin = vi.fn();
const handlers = new Map<string, (...a: unknown[]) => unknown>();
vi.mock("electron", () => ({ session: { defaultSession: { closeAllConnections: vi.fn(async () => {}) } } }));
vi.mock("electron-log", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../electron/security/trusted-ipc.js", () => ({
  handleTrusted: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn),
}));
vi.mock("../../electron/discovery/probe.js", () => ({ probeIdentity: (...a: unknown[]) => probe(...a) }));
vi.mock("../../electron/discovery/mdns-browser.js", () => ({ browseMdns: vi.fn() }));
vi.mock("../../electron/discovery/subnet-scan.js", () => ({ scanSubnet: vi.fn() }));
vi.mock("../../electron/ipc/secure-store.ipc.js", () => ({ writeSecureValue: vi.fn(), readSecureValue: vi.fn(() => null) }));
vi.mock("../../electron/security/lan-tls-pin.js", () => ({
  addTlsPin: (p: TlsPin) => addTlsPin(p),
  installLanTlsVerifier: vi.fn(),
  readTlsPins: () => [],
  removeTlsPins: vi.fn(),
}));

const src = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

beforeEach(() => {
  probe.mockReset();
  addTlsPin.mockReset();
});

describe("⭐ adres ayrıştırma tek kaynak: portsuz https 443", () => {
  it("https → 443, http → API varsayılanı, yazılan port korunur", () => {
    expect(serverUrlParts(CLOUD, 4000)).toEqual({ scheme: "https", host: "deneme.etkiliyazilim.com", port: 443 });
    expect(serverUrlParts("http://127.0.0.1", 4000)).toEqual({ scheme: "http", host: "127.0.0.1", port: 4000 });
    expect(serverUrlParts("https://192.168.1.50:4443", 4000)?.port).toBe(4443);
  });
  it("ana süreçte kendi düzenli ifadesiyle adres ayrıştıran kopya yok", () => {
    for (const f of ["electron/ipc/discovery.ipc.ts", "electron/ipc/lan-tls.ipc.ts"]) {
      expect(src(f)).toContain("serverUrlParts(url, DISCOVERY_DEFAULT_PORT)");
      expect(src(f)).not.toMatch(/\/\^\(https\?\):/);
    }
  });
});

describe("⭐ discovery:probe — bulut adresi", () => {
  async function probeHandler() {
    handlers.clear();
    const { registerDiscoveryIpc } = await import("../../electron/ipc/discovery.ipc");
    registerDiscoveryIpc();
    const h = handlers.get("discovery:probe");
    if (!h) throw new Error("discovery:probe kaydı yok");
    return (url: string) => h({}, url) as Promise<{ baseUrl: string } | null>;
  }

  it("portsuz https 443'ten, sıkı TLS ile, sabit aramadan yoklanır; kimliğin http/4000 beyanı adresi değiştirmez", async () => {
    probe.mockResolvedValue({ identity: PROXIED_IDENTITY, rttMs: 30, tls: null, observedFingerprint: EDGE });
    const res = await (await probeHandler())(CLOUD);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(CLOUD, 5000, { requireIdentity: true, strictTls: true });
    expect(res?.baseUrl).toBe(CLOUD);
  });
  it("elle yazılan port korunur", async () => {
    probe.mockResolvedValue({ identity: PROXIED_IDENTITY, rttMs: 30, tls: null, observedFingerprint: EDGE });
    const res = await (await probeHandler())(`${CLOUD}:8443`);
    expect(probe).toHaveBeenCalledWith(`${CLOUD}:8443`, 5000, { requireIdentity: true, strictTls: true });
    expect(res?.baseUrl).toBe(`${CLOUD}:8443`);
  });
  it("kimliksiz yanıt aday değildir", async () => {
    probe.mockResolvedValue(null);
    expect(await (await probeHandler())(CLOUD)).toBeNull();
  });
  it("LAN https adresi eskisi gibi sabit yolundan (sıkı TLS YOK)", async () => {
    probe.mockResolvedValue({ identity: { installationId: IID }, rttMs: 3, tls: null, observedFingerprint: FP });
    await (await probeHandler())("https://192.168.1.50:4443");
    expect(probe).toHaveBeenCalledWith("https://192.168.1.50:4443", 5000, { requireIdentity: true });
  });
});

describe("⛔ bulut kenarı sertifikası sabitlenmez", () => {
  it("ilansız gözlemde onay sunulmaz (fail-closed)", () => {
    const plan = planTlsSwitch({ host: "192.168.1.50", advert: null, observedFingerprint: EDGE, identity: null });
    expect(plan).toEqual({ kind: "unavailable", reason: UNADVERTISED_CERT_REASON });
  });
  it("internet adı ilanla bile kodla sabitlenmez", () => {
    const plan = planTlsSwitch({ host: "deneme.etkiliyazilim.com", advert: { port: 443, fingerprint: EDGE }, observedFingerprint: EDGE, identity: null });
    expect(plan).toEqual({ kind: "unavailable", reason: INTERNET_HOST_NOT_PINNABLE_REASON });
  });
  it("ana süreç kapısı: ilansız ya da internet adı → red", () => {
    const base = { host: "192.168.1.50", requested: EDGE, observed: EDGE, via: "confirmed" };
    expect(checkPinRequest({ ...base, advertised: null, internet: false })).toEqual({ ok: false, reason: UNADVERTISED_CERT_REASON });
    expect(checkPinRequest({ ...base, advertised: FP, internet: false }).ok).toBe(false);
    expect(checkPinRequest({ ...base, host: "deneme.etkiliyazilim.com", advertised: EDGE, internet: true }).ok).toBe(false);
    expect(checkPinRequest({ ...base, advertised: EDGE, internet: false }).ok).toBe(true);
  });
  it("pinViaHandshake: :443 bulut adresinde kenar sertifikası onaylansa da sabit yazılmaz", async () => {
    const { pinViaHandshake } = await import("../../electron/ipc/lan-tls.ipc");
    probe.mockResolvedValue({ identity: PROXIED_IDENTITY, rttMs: 30, tls: null, observedFingerprint: EDGE });
    const res = await pinViaHandshake({ baseUrl: `${CLOUD}:443`, fingerprint: EDGE, via: "confirmed" }, { onPinned: vi.fn() });
    expect(res.ok).toBe(false);
    expect(addTlsPin).not.toHaveBeenCalled();
  });
  it("pinViaHandshake: LAN'da ilansız sertifika sabitlenmez, ilanlı olan sabitlenir", async () => {
    const { pinViaHandshake } = await import("../../electron/ipc/lan-tls.ipc");
    probe.mockResolvedValue({ identity: { installationId: IID }, rttMs: 3, tls: null, observedFingerprint: FP });
    expect((await pinViaHandshake({ baseUrl: "https://192.168.1.50:4443", fingerprint: FP, via: "confirmed" }, { onPinned: vi.fn() })).ok).toBe(false);
    expect(addTlsPin).not.toHaveBeenCalled();
    probe.mockResolvedValue({ identity: { installationId: IID }, rttMs: 3, tls: { port: 4443, fingerprint: FP }, observedFingerprint: FP });
    expect((await pinViaHandshake({ baseUrl: "https://192.168.1.50:4443", fingerprint: FP, via: "confirmed" }, { onPinned: vi.fn() })).ok).toBe(true);
    expect(addTlsPin).toHaveBeenCalledTimes(1);
  });
});
