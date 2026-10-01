import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTERNAL_LINK_HOSTS, isAllowedExternalUrl, isShowableLocalPath } from "@shared/shell-policy";

// =============================================================================
// İŞLETİM SİSTEMİNE DEVİR POLİTİKASI (güvenlik denetimi 2026-10-01, IST-3/IST-5).
// İddia: panel işletim sistemine yalnız beyanlı https listesindeki adresi açtırır;
// protokol işleyicisi (ms-msdt:, search-ms:, file: UNC…) tetiklenemez.
// KALICI SONDA (K): eski kapılar — pencere açma/gezinme işleyicisinde HİÇ denetim yoktu,
// system:open-external'da `^https?://` — aynı saldırı kümesinin bir kısmını geçiriyordu.
// =============================================================================

const legacyOpenExternalGate = (url: string): boolean => /^https?:\/\//i.test(url);

const SCHEME_ATTACKS = [
  "ms-msdt:/id PCWDiagnostic /skip force",
  "search-ms:query=fatura&crumb=location:\\\\saldirgan\\pay",
  "file://saldirgan/pay/kur.exe",
  "file:///C:/Windows/System32/calc.exe",
  "javascript:alert(1)",
  "smb://saldirgan/pay",
  "mailto:a@b.c",
];

const HOST_ATTACKS = [
  "http://etkiliyazilim.com",
  "https://saldirgan.com/",
  "https://etkiliyazilim.com.saldirgan.com/",
  "https://etkiliyazılım.com/",
  "https://u:p@etkiliyazilim.com/",
  "https://etkiliyazilim.com:8443/",
];

describe("dış bağlantı izin listesi", () => {
  it("beyanlı satıcı adresleri açılır", () => {
    expect(isAllowedExternalUrl("https://etkiliyazilim.com")).toBe(true);
    expect(isAllowedExternalUrl("https://ETKILIYAZILIM.COM/destek?a=1#b")).toBe(true);
    expect(isAllowedExternalUrl("https://www.etkiliyazilim.com/")).toBe(true);
  });

  it("⭐ şema saldırıları ve izinsiz ana makineler AÇILMAZ", () => {
    for (const url of [...SCHEME_ATTACKS, ...HOST_ATTACKS]) expect(isAllowedExternalUrl(url), url).toBe(false);
    for (const junk of [null, undefined, 42, {}, "", "x".repeat(3000)]) expect(isAllowedExternalUrl(junk)).toBe(false);
  });

  it("K-sonda: eski system:open-external kapısı ana makine saldırılarını geçiriyordu", () => {
    const passedLegacy = HOST_ATTACKS.filter(legacyOpenExternalGate);
    expect(passedLegacy.length).toBeGreaterThanOrEqual(5);
  });

  it("liste yalnız ölçülen kullanımı taşır: renderer'daki her dış adres listede", () => {
    const sources = ["src/components/layout/sidebar-brand.tsx", "src/pages/Login/LoginHero.tsx"].map((p) =>
      readFileSync(resolve(process.cwd(), p), "utf8"),
    );
    const urls = sources.flatMap((s) => [...s.matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]!));
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) expect(isAllowedExternalUrl(url), url).toBe(true);
    expect(EXTERNAL_LINK_HOSTS.every((h) => !h.includes("*"))).toBe(true);
  });
});

describe("klasörde göster: yalnız yerel mutlak yol", () => {
  it("yerel yollar geçer", () => {
    expect(isShowableLocalPath("C:\\Users\\muhasebe\\Belgeler\\irsaliye.pdf")).toBe(true);
    expect(isShowableLocalPath("D:/arsiv/fatura.xlsx")).toBe(true);
    expect(isShowableLocalPath("/Users/demo/Desktop/a.pdf")).toBe(true);
  });

  it("⭐ UNC/ağ yolu, göreli yol ve bozuk girdi reddedilir", () => {
    for (const p of ["\\\\saldirgan\\pay\\a.pdf", "//saldirgan/pay/a.pdf", "\\\\?\\C:\\a.pdf", "belge.pdf", "..\\..\\a", "C:a.pdf", "C:\\a\0b", "", null, 3]) {
      expect(isShowableLocalPath(p), String(p)).toBe(false);
    }
  });
});
