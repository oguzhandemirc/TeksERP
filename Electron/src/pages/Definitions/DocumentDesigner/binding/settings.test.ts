import { describe, expect, it } from "vitest";
import { applySettingsPatch, lockLanguage } from "./docSettings";
import { clampMargin, DEFAULT_PAGE_SETTINGS, normalizePageSettings, pageNumberPreview, regionPreview, toCanvasPaper } from "./pageSettings";

describe("Belge ayarları: dil kilidi", () => {
  it("patch settings nesnesini değiştirir ama language tr kalır", () => {
    const s0 = { language: "tr", showSignatures: true, signatureLabels: ["A"] };
    const s1 = applySettingsPatch(s0, { showSignatures: false, language: "en" });
    expect(s1).toEqual({ language: "tr", showSignatures: false, signatureLabels: ["A"] });
    expect(s0.showSignatures).toBe(true);
    expect(applySettingsPatch(s1, { language: "auto" }).language).toBe("tr");
  });
  it("dışarıdan en gelse de kilitlenir", () => {
    expect(lockLanguage({ language: "en" }).language).toBe("tr");
  });
});

describe("sayfa ayarı", () => {
  it("kenar 0–50 mm", () => {
    expect(clampMargin(-3)).toBe(0);
    expect(clampMargin(80)).toBe(50);
    expect(clampMargin(12.34)).toBe(12.3);
  });
  it("bilinmeyen değer varsayılana; alt bilgide sol kutu yok", () => {
    const s = normalizePageSettings({ kagit: "B5", yon: "yatay", altBilgi: { sol: "x", sag: "y" }, kenar: { ust: 99 } });
    expect(s.kagit).toBe("A4");
    expect(s.yon).toBe("yatay");
    expect(s.altBilgi).toEqual({ orta: "", sag: "y" });
    expect("sol" in s.altBilgi).toBe(false);
    expect(s.kenar.ust).toBe(50);
  });
  it("kanvas kâğıdı ve temsil metinleri", () => {
    expect(toCanvasPaper({ ...DEFAULT_PAGE_SETTINGS, kagit: "A5", yon: "yatay" })).toEqual({ paper: "A5", orientation: "landscape" });
    expect(pageNumberPreview("Sayfa {n} / {N}")).toBe("Sayfa 1 / 3");
    const r = regionPreview({ ...DEFAULT_PAGE_SETTINGS, ustBilgi: { sol: "A", orta: "", sag: "B" }, sayfaNo: { konum: "alt-sag", bicim: "{n}" } });
    expect(r).toEqual({ header: "A   ·   B", footer: "1" });
  });
});
