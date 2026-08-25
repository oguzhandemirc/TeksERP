import { beforeEach, describe, expect, it } from "vitest";
import { canGoBackTab, forgetTab, trackTabLocation } from "./history-depth";

/**
 * GERİ TUŞUNUN TEK DOĞRU KAYNAĞI — "REPLACE geçmişe adım eklemez" kuralı.
 *
 * Saha (2026-08-22): geri tuşu Raporlar/Yetkilendirme/Sistem'de çalışıyor,
 * Tanımlar/Operasyon'da çalışmıyordu. Fark, liste sayfalarının açılışta
 * `setSearchParams(…, { replace: true })` ile varsayılan sekmeyi URL'e
 * yazmasıydı: `location.key` "default" olmaktan çıkıyor, "geri gidilebilir"
 * sanılıyor, `navigate(-1)` sessizce hiçbir şey yapmıyordu.
 */

const T = "tab-1";
beforeEach(() => forgetTab(T));

describe("history-depth", () => {
  it("açılış konumu adım DEĞİLDİR", () => {
    trackTabLocation(T, "default", "POP");
    expect(canGoBackTab(T)).toBe(false);
  });

  it("REPLACE geçmişi büyütmez (asıl hata) — açılışta URL'e filtre yazan liste sayfası", () => {
    trackTabLocation(T, "default", "POP");
    trackTabLocation(T, "k-replace", "REPLACE");
    expect(canGoBackTab(T)).toBe(false);
  });

  it("PUSH bir adım ekler, POP geri alır", () => {
    trackTabLocation(T, "default", "POP");
    trackTabLocation(T, "k1", "PUSH");
    expect(canGoBackTab(T)).toBe(true);
    trackTabLocation(T, "default", "POP");
    expect(canGoBackTab(T)).toBe(false);
  });

  it("aynı gezinmenin tekrar eden olayları (loading → idle) iki kez sayılmaz", () => {
    trackTabLocation(T, "default", "POP");
    trackTabLocation(T, "k1", "PUSH");
    trackTabLocation(T, "k1", "PUSH");
    trackTabLocation(T, "default", "POP");
    expect(canGoBackTab(T)).toBe(false);
  });

  it("POP derinliği eksiye düşürmez", () => {
    trackTabLocation(T, "default", "POP");
    trackTabLocation(T, "k1", "POP");
    trackTabLocation(T, "k2", "POP");
    expect(canGoBackTab(T)).toBe(false);
  });

  it("bilinmeyen sekme + kapanan sekme: geri gidilemez", () => {
    expect(canGoBackTab("yok")).toBe(false);
    trackTabLocation(T, "default", "POP");
    trackTabLocation(T, "k1", "PUSH");
    forgetTab(T);
    expect(canGoBackTab(T)).toBe(false);
  });
});
