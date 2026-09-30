import { describe, expect, it } from "vitest";
import type { LicenseAcceptanceView } from "@/types/license";
import { acceptanceGate, inlineSegments } from "./acceptance";

const view = (durum: LicenseAcceptanceView["durum"]): LicenseAcceptanceView => ({
  metin: { kimlik: "KM-2026.1-taslak", ozet: "a".repeat(64), taslak: true, bloklar: [], kutular: ["1"] },
  durum,
  gecerli: null,
  kayitlar: [],
  anahtarKimligi: "kur-x",
  oneri: { adSoyad: null },
});

/** Etkinleştirmenin tek kapısı (Ek-7): yalnız GECERLI açar; okunamayan kabul KAPALI (fail-closed). */
describe("acceptanceGate", () => {
  it("yalnız GECERLI kabul etkinleştirmeyi açar", () => {
    expect(acceptanceGate({ isLoading: false, error: null, data: view("GECERLI") })).toEqual({ ready: true, reason: null });
  });

  it.each(["YOK", "METIN_DEGISTI", "ANAHTAR_DEGISTI"] as const)("%s → kapalı, Türkçe gerekçe", (durum) => {
    const g = acceptanceGate({ isLoading: false, error: null, data: view(durum) });
    expect(g.ready).toBe(false);
    expect(g.reason).toMatch(/kabul/);
  });

  it("eski backend (uç yok → 404) kapalı ve 'sunucuyu güncelleyin' der; başka hata da kapalı", () => {
    const eski = acceptanceGate({ isLoading: false, error: { response: { status: 404 } }, data: undefined });
    expect(eski).toEqual({ ready: false, reason: "Sunucu sürümü sözleşme kabulünü desteklemiyor; önce sunucuyu güncelleyin." });
    expect(acceptanceGate({ isLoading: false, error: { response: { status: 500 } }, data: undefined }).ready).toBe(false);
  });

  it("yüklenirken kapalı", () => {
    expect(acceptanceGate({ isLoading: true, error: null, data: undefined }).ready).toBe(false);
  });
});

describe("inlineSegments", () => {
  it("kalın ve eğik vurgu ayrışır, düz metin olduğu gibi kalır", () => {
    expect(inlineSegments("Bu **kalın** ve *(eğik)* metin")).toEqual([
      { text: "Bu ", bold: false, italic: false },
      { text: "kalın", bold: true, italic: false },
      { text: " ve ", bold: false, italic: false },
      { text: "(eğik)", bold: false, italic: true },
      { text: " metin", bold: false, italic: false },
    ]);
  });

  it("vurgusuz metin tek parça; kelime kaybolmaz", () => {
    const t = "Kullanıcı ve cihaz sayısı sınırsızdır.";
    expect(inlineSegments(t).map((s) => s.text).join("")).toBe(t);
  });
});
