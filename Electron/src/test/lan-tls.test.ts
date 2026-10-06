// Bekçi: fabrika ağında TLS — panelin sabitleme kararları (docs/design/LAN-TLS.md §4, §6).
// Saf kararlar (`@shared/lan-tls`) + ana süreç bağlantısının kaynak düzeyi sözleri (HTTP'ye düşüş yok).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TLS_PIN_KEY,
  buildTlsQr,
  certVerifyDecision,
  checkPinRequest,
  formatFingerprintGroups,
  isLoopbackHost,
  normalizeFingerprint,
  parseTlsAdvert,
  parseTlsPins,
  parseTlsQr,
  routeFor,
  withPin,
  type TlsPin,
} from "@shared/lan-tls";
import { MAIN_ONLY_KEYS } from "../../electron/ipc/secure-store.core";

const DER = Buffer.from("bekci-sertifikasi");
const FP = createHash("sha256").update(DER).digest("hex");
const OTHER = "ab".repeat(32);
const IID = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";
const pin = (over: Partial<TlsPin> = {}): TlsPin => ({
  installationId: IID,
  fingerprint: FP,
  port: 4443,
  via: "confirmed",
  pinnedAt: "2026-10-06T00:00:00Z",
  ...over,
});
const src = (p: string): string => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("parmak izi biçimi", () => {
  it("onaltılık, iki noktalı ve Electron sha256/base64 biçimi AYNI değere iner", () => {
    const b64 = createHash("sha256").update(DER).digest("base64");
    expect(normalizeFingerprint(FP.toUpperCase())).toBe(FP);
    expect(normalizeFingerprint(FP.match(/../g)!.join(":"))).toBe(FP);
    expect(normalizeFingerprint(`sha256/${b64}`)).toBe(FP);
    expect(normalizeFingerprint(formatFingerprintGroups(FP))).toBe(FP);
  });
  it("kısa, uzun, onaltılık olmayan ve tip dışı girdi REDDEDİLİR", () => {
    for (const bad of [FP.slice(1), `${FP}0`, "z".repeat(64), "sha256/abc", 42, null, ""]) {
      expect(normalizeFingerprint(bad)).toBeNull();
    }
  });
});

describe("Chromium doğrulama kancası", () => {
  it("sabitli parmak izi → 0, sabitsiz → -3 (Chromium'un kendi kararı)", () => {
    expect(certVerifyDecision([pin()], FP)).toBe(0);
    expect(certVerifyDecision([pin()], OTHER)).toBe(-3);
    expect(certVerifyDecision([], FP)).toBe(-3);
    expect(certVerifyDecision([pin()], "çöp")).toBe(-3);
  });
});

describe("kanal seçimi — sabit varken HTTP'ye düşülmez", () => {
  it("sabit yok → HTTP (bugünkü davranış)", () => {
    expect(routeFor([], IID, { port: 4443, fingerprint: FP })).toEqual({ kind: "http" });
    expect(routeFor([pin({ installationId: "baska" })], IID, null)).toEqual({ kind: "http" });
  });
  it("sabit var + sunucu TLS ilan etmiyor → ENGEL", () => {
    expect(routeFor([pin()], IID, null).kind).toBe("blocked");
  });
  it("sabit var + ilandaki parmak izi farklı → ENGEL", () => {
    expect(routeFor([pin()], IID, { port: 4443, fingerprint: OTHER }).kind).toBe("blocked");
  });
  it("sabit var + ilan eşleşiyor → HTTPS, ilandaki portla", () => {
    const r = routeFor([pin()], IID, { port: 5443, fingerprint: FP });
    expect(r.kind).toBe("https");
    expect(r.kind === "https" && r.port).toBe(5443);
  });
});

describe("sabitleme isteği — TOFU yok", () => {
  it("gözlenen sertifika onaylanan koddan farklıysa RED", () => {
    expect(checkPinRequest({ host: "10.0.0.5", requested: FP, observed: OTHER, via: "confirmed" }).ok).toBe(false);
  });
  it("el sıkışma olmadıysa RED", () => {
    expect(checkPinRequest({ host: "10.0.0.5", requested: FP, observed: null, via: "confirmed" }).ok).toBe(false);
  });
  it("otomatik (loopback) yol yalnız döngü adresinde", () => {
    expect(checkPinRequest({ host: "10.0.0.5", requested: FP, observed: FP, via: "loopback" }).ok).toBe(false);
    expect(checkPinRequest({ host: "127.0.0.1", requested: FP, observed: FP, via: "loopback" }).ok).toBe(true);
    expect(checkPinRequest({ host: "localhost", requested: FP, observed: FP, via: "loopback" }).ok).toBe(true);
  });
  it("LAN adresinde yalnız kullanıcının açık onayıyla", () => {
    expect(checkPinRequest({ host: "10.0.0.5", requested: FP, observed: FP, via: "confirmed" }).ok).toBe(true);
    expect(checkPinRequest({ host: "10.0.0.5", requested: FP, observed: FP, via: "auto" }).ok).toBe(false);
  });
  it("döngü adresi tanıma", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
  });
});

describe("sabit deposu", () => {
  it("aynı kurulumun eski sabiti yeniyle değişir, başka kurulumunki kalır", () => {
    const next = withPin([pin(), pin({ installationId: "baska", fingerprint: OTHER })], pin({ fingerprint: OTHER }));
    expect(next.filter((p) => p.installationId === IID).map((p) => p.fingerprint)).toEqual([OTHER]);
    expect(next).toHaveLength(2);
  });
  it("bozuk kayıt boş listeye iner, geçersiz parmak izli satır atılır", () => {
    expect(parseTlsPins("{bozuk")).toEqual([]);
    expect(parseTlsPins(JSON.stringify([{ fingerprint: "kısa", port: 1 }, pin()]))).toHaveLength(1);
  });
  it("renderer sabite YAZAMAZ (ana süreç anahtarı)", () => {
    expect(MAIN_ONLY_KEYS.has(TLS_PIN_KEY)).toBe(true);
  });
});

describe("tablet QR'ı", () => {
  it("gidiş-dönüş aynı ilan ve kurulum", () => {
    const qr = buildTlsQr(IID, { port: 4443, fingerprint: FP });
    expect(parseTlsQr(qr)).toEqual({ installationId: IID, advert: { port: 4443, fingerprint: FP } });
    expect(parseTlsQr(buildTlsQr(null, { port: 4443, fingerprint: FP }))?.installationId).toBeNull();
  });
  it("biçimsiz QR reddedilir", () => {
    for (const bad of ["", "teks-erp-tls:2:x", `teks-erp-tls:1:${IID}:${FP}`, `teks-erp-tls:1:${IID}:${FP.toUpperCase()}:4443`, `teks-erp-tls:1:${IID}:${FP}:99999`]) {
      expect(parseTlsQr(bad)).toBeNull();
    }
  });
  it("ilan ayrıştırma port sınırları", () => {
    expect(parseTlsAdvert({ port: 0, fingerprint: FP })).toBeNull();
    expect(parseTlsAdvert({ port: 4443, fingerprint: FP })).toEqual({ port: 4443, fingerprint: FP });
  });
});

describe("ana süreç bağlantısı (kaynak)", () => {
  it("main.ts doğrulama kancasını oturuma takar", () => {
    expect(src("electron/main.ts")).toMatch(/installLanTlsVerifier\(session\.defaultSession\)/);
  });
  it("keşif HTTP adayını sabit kararından geçirir; engelde aday döndürmez", () => {
    const d = src("electron/ipc/discovery.ipc.ts");
    expect(d).toMatch(/const route = routeFor\(readTlsPins\(\), res\.identity\?\.installationId \?\? null, res\.tls\);/);
    expect(d).toMatch(/if \(route\.kind === "blocked"\) \{\s*noteTlsBlocked\(host, route\.reason\);\s*return null;/);
    expect(d).toMatch(/if \(route\.kind === "https"\) return verifyHttpsCandidate\(ctx, route\.port\);/);
  });
  it("HTTPS adayı gözlenen parmak izi sabitte değilse düşer", () => {
    expect(src("electron/discovery/tls-candidate.ts")).toMatch(/if \(!mine\.some\(\(p\) => p\.fingerprint === res\.observedFingerprint\)\) \{/);
  });
  it("sabitleme ana sürecin KENDİ el sıkışmasıyla (gözlenen = istenen)", () => {
    expect(src("electron/ipc/lan-tls.ipc.ts")).toMatch(/observed: viaTls\?\.observedFingerprint \?\? null,/);
  });
});
