// Bekçi: panel fabrika sunucusuna YALNIZ şifreli bağlanır (kullanıcı kararı 2026-10-08, docs/design/LAN-TLS.md §6).
// Dört kapı: ağdaki http:// kabul edilmez · iz tutmazsa bağlanılmaz · döngü dışı adres kodsuz güvenilmez ·
// doğrulama kodunun biçimi tek kaynaktan (panel = sunucu = kurulum) ayrışmaz.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HTTP_NETWORK_REFUSED_REASON,
  UNPAIRED_HTTPS_REASON,
  certVerifyDecision,
  checkPinRequest,
  formatFingerprintGroups,
  panelTransportFor,
  plainRequestAllowed,
  type TlsPin,
} from "@shared/lan-tls";
import { isInternetHost, kipFor } from "@shared/internet-tls";

const FP = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const PIN: TlsPin = { installationId: "11111111-2222-3333-4444-555555555555", fingerprint: FP, port: 4443, via: "confirmed", pinnedAt: "" };

const probe = vi.fn();
const addTlsPin = vi.fn();
vi.mock("electron", () => ({ session: { defaultSession: { closeAllConnections: vi.fn(async () => {}) } } }));
vi.mock("electron-log", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../electron/security/trusted-ipc.js", () => ({ handleTrusted: vi.fn() }));
vi.mock("../../electron/discovery/probe.js", () => ({ probeIdentity: (...a: unknown[]) => probe(...a) }));
vi.mock("../../electron/ipc/secure-store.ipc.js", () => ({ writeSecureValue: vi.fn(), readSecureValue: vi.fn() }));
vi.mock("../../electron/security/lan-tls-pin.js", () => ({
  addTlsPin: (p: TlsPin) => addTlsPin(p),
  installLanTlsVerifier: vi.fn(),
  readTlsPins: () => [],
  removeTlsPins: vi.fn(),
}));

describe("⛔ ağdaki http:// kabul edilmez", () => {
  const t = (url: string, pins: TlsPin[] = []) => panelTransportFor(pins, url, isInternetHost);
  it("ağ adresinde http — sabit olsa da — red, Türkçe sebep", () => {
    expect(t("http://192.168.1.50:4000")).toEqual({ kind: "refused", reason: HTTP_NETWORK_REFUSED_REASON });
    expect(t("http://192.168.1.50:4443", [PIN]).kind).toBe("refused");
    expect(t("http://sahinsrv:4000").kind).toBe("refused");
    expect(t("http://fabrika.etkiliyazilim.com").kind).toBe("refused");
    expect(t("http://127.0.0.1@10.0.0.5:4000").kind).toBe("refused");
    expect(t("http://localhost.evil.com:4000").kind).toBe("refused");
  });
  it("döngü adresi http'de serbest (paket makineden çıkmaz)", () => {
    for (const u of ["http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"]) expect(t(u).kind).toBe("loopback");
  });
  it("ağ katmanı: http/ws yalnız döngüye; https ve yerel şemalar kapı dışı; çözülemeyen http kapalı", () => {
    expect(plainRequestAllowed("http://192.168.1.50:4000/api/auth/login")).toBe(false);
    expect(plainRequestAllowed("ws://192.168.1.50:4000/socket")).toBe(false);
    expect(plainRequestAllowed("http://localhost.evil.com/")).toBe(false);
    expect(plainRequestAllowed("http://[bozuk")).toBe(false);
    expect(plainRequestAllowed("http://localhost:5174/src/main.tsx")).toBe(true);
    expect(plainRequestAllowed("ws://127.0.0.1:5174/")).toBe(true);
    expect(plainRequestAllowed("https://192.168.1.50:4443/api/health")).toBe(true);
    expect(plainRequestAllowed("file:///C:/TeksERP/index.html")).toBe(true);
  });
  it("ağ kapısı oturuma takılır ve ağdaki http isteğini keser", async () => {
    const { installPlainHttpGuard } = await import("../../electron/security/plain-http-guard");
    let listener: ((d: { url: string }, cb: (r: { cancel: boolean }) => void) => void) | null = null;
    installPlainHttpGuard({ webRequest: { onBeforeRequest: (l: typeof listener) => (listener = l) } } as never);
    const cb = vi.fn();
    listener!({ url: "http://10.0.0.5:4000/api/users" }, cb);
    listener!({ url: "https://10.0.0.5:4443/api/users" }, cb);
    expect(cb.mock.calls).toEqual([[{ cancel: true }], [{ cancel: false }]]);
  });
});

describe("⛔ iz tutmazsa bağlanılmaz", () => {
  it("sertifika kancası yalnız sabitli izi kabul eder, gerisi Chromium'a (-3: kendinden imzalı red)", () => {
    expect(certVerifyDecision([PIN], FP)).toBe(0);
    expect(certVerifyDecision([PIN], OTHER)).toBe(-3);
    expect(certVerifyDecision([], FP)).toBe(-3);
  });
  it("sabitsiz ağ https'i kaydedilmez (eşleşme ister); sabitli port kabul", () => {
    expect(panelTransportFor([], "https://192.168.1.50:4443", isInternetHost)).toEqual({ kind: "refused", reason: UNPAIRED_HTTPS_REASON });
    expect(panelTransportFor([PIN], "https://192.168.1.50:4443", isInternetHost)).toEqual({ kind: "pinned", pin: PIN });
  });
  it("sabitleme gözlenen izle aynı olmalı", () => {
    expect(checkPinRequest({ host: "192.168.1.50", requested: FP, observed: OTHER, advertised: FP, internet: false, via: "confirmed" }).ok).toBe(false);
  });
  it("internet kipi: yalnız izinli üst alanın altındaki ad, sabitsiz (sistem güveni)", () => {
    expect(panelTransportFor([], "https://fabrika.etkiliyazilim.com", isInternetHost).kind).toBe("internet");
    for (const h of ["etkiliyazilim.com", "fabrika.etkiliyazilim.com.evil.com", "x.etkiliyazilim.local", "10.0.0.5"]) expect(kipFor(h)).toBe("sabitli");
  });
});

describe("⛔ döngü dışı adres kodsuz güvenilmez", () => {
  beforeEach(() => {
    probe.mockReset();
    addTlsPin.mockReset();
  });
  it("loopback yolu ağ adresinde reddedilir", () => {
    expect(checkPinRequest({ host: "192.168.1.50", requested: FP, observed: FP, advertised: FP, internet: false, via: "loopback" }).ok).toBe(false);
    expect(checkPinRequest({ host: "127.0.0.1", requested: FP, observed: FP, advertised: FP, internet: false, via: "loopback" }).ok).toBe(true);
  });
  it("otomatik sabitleme ağ adresinde hiç yoklamaz, hiç sabitlemez", async () => {
    const { autoPinLoopback } = await import("../../electron/ipc/lan-tls.ipc");
    expect(await autoPinLoopback("http://192.168.1.50:4000", { onPinned: vi.fn() })).toBeNull();
    expect(await autoPinLoopback("https://sahinsrv:4443", { onPinned: vi.fn() })).toBeNull();
    expect(probe).not.toHaveBeenCalled();
    expect(addTlsPin).not.toHaveBeenCalled();
  });
  it("sunucu makinesinin kendisi: ilan = el sıkışma ise sorusuz 'loopback' sabitlenir, https döngüye geçilir", async () => {
    const { autoPinLoopback } = await import("../../electron/ipc/lan-tls.ipc");
    const identity = { installationId: PIN.installationId };
    probe.mockImplementation(async (url: string) =>
      url.startsWith("https:") ? { identity, tls: { port: 4443, fingerprint: FP }, observedFingerprint: FP } : { identity, tls: { port: 4443, fingerprint: FP } },
    );
    const onPinned = vi.fn();
    expect(await autoPinLoopback("http://localhost:4000", { onPinned })).toEqual({ ok: true, baseUrl: "https://localhost:4443" });
    expect(addTlsPin).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: FP, via: "loopback", port: 4443 }));
    expect(onPinned).toHaveBeenCalledWith(PIN.installationId);
  });
  it("döngüde ilan ile el sıkışma ayrışırsa sabitlenmez", async () => {
    const { autoPinLoopback } = await import("../../electron/ipc/lan-tls.ipc");
    probe.mockImplementation(async (url: string) =>
      url.startsWith("https:") ? { identity: null, tls: null, observedFingerprint: OTHER } : { identity: null, tls: { port: 4443, fingerprint: FP } },
    );
    expect(await autoPinLoopback("http://127.0.0.1:4000", { onPinned: vi.fn() })).toBeNull();
    expect(addTlsPin).not.toHaveBeenCalled();
  });
});

describe("⛔ doğrulama kodu biçimi tek kaynak (panel = tablet = sunucu = kurulum)", () => {
  const ROOT = resolve(__dirname, "../../..");
  const fnText = (src: string, name: string) => {
    const start = src.indexOf(`export function ${name}(`);
    return start < 0 ? null : src.slice(start, src.indexOf("\n}\n", start) + 2);
  };
  const norm = (t: string) => t.replace(/"/g, "'").replace(/\s+/g, "");
  it("biçim: 16 grup × 4 büyük harf", () => {
    expect(formatFingerprintGroups(FP)).toBe(Array(16).fill("ABAB").join(" "));
  });
  it("sunucunun (durum sayfası) biçimleyicisi panelinkiyle metin olarak aynı", () => {
    const ele = readFileSync(join(ROOT, "Electron/shared/lan-tls.ts"), "utf8");
    const srv = readFileSync(join(ROOT, "Teks-Erp/src/lib/lan-tls/store.ts"), "utf8");
    expect(fnText(srv, "formatFingerprintGroups")).not.toBeNull();
    expect(norm(fnText(srv, "formatFingerprintGroups")!)).toBe(norm(fnText(ele, "formatFingerprintGroups")!));
  });
  it("kurulum betiğinin gruplayıcısı aynı kuralı taşır (büyük harf, 4'lük, boşlukla)", () => {
    const ps = readFileSync(join(ROOT, "deploy/kurulum/kurulum-ortak.ps1"), "utf8");
    const body = /function ParmakIziGrupla\(\[string\]\$hex\) \{([\s\S]*?)\n\}/.exec(ps)?.[1] ?? "";
    expect(body).toContain("$hex.ToUpperInvariant()");
    expect(body).toContain("$i += 4");
    expect(body).toContain('-join " "');
  });
  it("panelde kod başka yerde biçimlenmez (yalnız formatFingerprintGroups)", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && readFileSync(p, "utf8").includes(".{1,4}")) hits.push(p.slice(ROOT.length + 1));
      }
    };
    for (const d of ["Electron/src", "Electron/electron", "Electron/shared"]) walk(join(ROOT, d));
    expect(hits).toEqual(["Electron/shared/lan-tls.ts"]);
  });
  it("internet kipi ikizi: tablet dosyası varsa kipFor ve üst alan listesi aynı", () => {
    const mob = join(ROOT, "mobil/src/lib/internet-tls.ts");
    if (!existsSync(mob)) return; // tablet vc61 ana dala inene dek ikiz yok
    const m = readFileSync(mob, "utf8");
    const e = readFileSync(join(ROOT, "Electron/shared/internet-tls.ts"), "utf8");
    expect(norm(fnText(e, "kipFor")!)).toBe(norm(fnText(m, "kipFor")!));
    const list = (s: string) => /INTERNET_PARENT_DOMAINS: readonly string\[\] = (\[.*\]);/.exec(s)?.[1]?.replace(/"/g, "'") ?? null;
    expect(list(e)).not.toBeNull();
    expect(list(e)).toBe(list(m));
  });
});
