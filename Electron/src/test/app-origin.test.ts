import { describe, expect, it } from "vitest";
import {
  appEntryArgument,
  isAllowedSubframeUrl,
  isAppDocumentUrl,
  readAppEntryArgument,
} from "@shared/app-origin";

// =============================================================================
// UYGULAMA BELGESİ KİMLİĞİ (güvenlik denetimi 2026-10-01, IST-5) — gezinme kapısı,
// IPC gönderen denetimi ve preload köprüsü AYNI yüklemi kullanır.
// İddia: ana çerçeve yalnız uygulamanın KENDİ index.html'inde kalabilir; ağ paylaşımı
// (UNC), başka yerel dosya, splash ve yabancı köken "uygulama" SAYILMAZ.
// KALICI SONDA (K): eski kapı (`url.startsWith("file://")`) aynı saldırı kümesinin
// her birini GEÇİRİYORDU — küme ayırt edici olmasaydı bu kontrol vakumen yeşil kalırdı.
// =============================================================================

const WIN_ENTRY = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
const MAC_ENTRY = "file:///Applications/Teks%20ERP.app/Contents/Resources/app.asar/out/renderer/index.html";
const DEV_ENTRY = "http://localhost:5174";

/** 2026-10-01 öncesi main.ts gezinme kapısı. */
const legacyGate = (url: string): boolean => url.startsWith("file://");

/** Chromium'un gezinme olayına verdiği KANONİK biçimler (ters eğik çizgili yazım `file://`ye çevrilmiş gelir). */
const FILE_ATTACKS = [
  "file://saldirgan/pay/index.html",
  "file://192.168.1.66/pay/out/renderer/index.html",
  "file:////saldirgan/pay/out/renderer/index.html",
  "file:///C:/Users/Public/evil/out/renderer/index.html",
  "file:///C:/Program%20Files/TeksERP/resources/splash.html",
  "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html%00.evil",
];

describe("uygulama belgesi kimliği", () => {
  it("kendi giriş belgesi: hash/sorgu serbest, Windows'ta harf duyarsız", () => {
    expect(isAppDocumentUrl(WIN_ENTRY, WIN_ENTRY, "win32")).toBe(true);
    expect(isAppDocumentUrl(`${WIN_ENTRY}#/operasyon/is-emirleri`, WIN_ENTRY, "win32")).toBe(true);
    expect(isAppDocumentUrl(`${WIN_ENTRY}?x=1#/a`, WIN_ENTRY, "win32")).toBe(true);
    expect(isAppDocumentUrl(WIN_ENTRY.replace("C:/Program%20Files", "c:/program%20files"), WIN_ENTRY, "win32")).toBe(true);
    expect(isAppDocumentUrl(WIN_ENTRY.replace("file:///", "file://localhost/"), WIN_ENTRY, "win32")).toBe(true);
    expect(isAppDocumentUrl(`${MAC_ENTRY}#/`, MAC_ENTRY, "darwin")).toBe(true);
  });

  it("⭐ UNC/ağ paylaşımı, başka yerel dosya ve splash uygulama SAYILMAZ", () => {
    for (const url of FILE_ATTACKS) expect(isAppDocumentUrl(url, WIN_ENTRY, "win32"), url).toBe(false);
    expect(isAppDocumentUrl("file:\\\\saldirgan\\pay\\index.html", WIN_ENTRY, "win32")).toBe(false);
  });

  it("K-sonda: eski kapı aynı saldırı kümesinin HER birini geçiriyordu", () => {
    expect(FILE_ATTACKS.length).toBeGreaterThanOrEqual(5);
    for (const url of FILE_ATTACKS) expect(legacyGate(url), url).toBe(true);
  });

  it("macOS'ta harf farkı AYNI belge sayılmaz (dosya sistemi kararı platformdan)", () => {
    expect(isAppDocumentUrl(MAC_ENTRY.replace("Applications", "applications"), MAC_ENTRY, "darwin")).toBe(false);
  });

  it("geliştirme sunucusu: yalnız aynı köken", () => {
    expect(isAppDocumentUrl("http://localhost:5174/#/x", DEV_ENTRY, "darwin")).toBe(true);
    expect(isAppDocumentUrl("http://localhost:5175/", DEV_ENTRY, "darwin")).toBe(false);
    expect(isAppDocumentUrl("http://localhost:5174@saldirgan.com/", DEV_ENTRY, "darwin")).toBe(false);
    expect(isAppDocumentUrl("https://localhost:5174/", DEV_ENTRY, "darwin")).toBe(false);
    expect(isAppDocumentUrl(WIN_ENTRY, DEV_ENTRY, "win32")).toBe(false);
  });

  it("giriş adresi yoksa ya da bozuksa her şey RED (fail-closed)", () => {
    expect(isAppDocumentUrl(WIN_ENTRY, null, "win32")).toBe(false);
    expect(isAppDocumentUrl(WIN_ENTRY, "değil-bir-url", "win32")).toBe(false);
    expect(isAppDocumentUrl("değil-bir-url", WIN_ENTRY, "win32")).toBe(false);
    expect(isAppDocumentUrl("file:///C:/%E0%A4%A", "file:///C:/%E0%A4%A", "win32")).toBe(false);
    expect(isAppDocumentUrl("data:text/html,<p>x</p>", "data:text/html,<p>x</p>", "win32")).toBe(false);
  });

  it("preload bayrağı gidiş-dönüş: ana süreç yazar, preload okur", () => {
    const argv = ["electron", "--type=renderer", appEntryArgument(WIN_ENTRY), "--x=1"];
    expect(readAppEntryArgument(argv)).toBe(WIN_ENTRY);
    expect(readAppEntryArgument(["electron", "--type=renderer"])).toBeNull();
    expect(readAppEntryArgument([appEntryArgument("")])).toBeNull();
  });

  it("alt çerçeve yalnız srcdoc/boş belgeye gider", () => {
    expect(isAllowedSubframeUrl("about:srcdoc")).toBe(true);
    expect(isAllowedSubframeUrl("about:blank")).toBe(true);
    for (const url of ["https://saldirgan.com/", "file://saldirgan/pay/x.html", "blob:file:///abc", "data:text/html,x", "javascript:alert(1)", WIN_ENTRY]) {
      expect(isAllowedSubframeUrl(url), url).toBe(false);
    }
  });
});
