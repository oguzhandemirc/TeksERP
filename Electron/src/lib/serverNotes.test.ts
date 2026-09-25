import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { serverSuccessText, shouldToastWarnings, showServerWarnings, toastServerSuccess } from "./serverNotes";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

// Her testte AYRI metin: tekrar penceresi modül düzeyinde durum tutar.
describe("serverNotes — sunucu notlarının tek kaynağı", () => {
  beforeEach(() => vi.clearAllMocks());

  it("her uyarı ayrı toast.warning, 8 sn", () => {
    showServerWarnings({ warnings: ["N-1 a", "N-1 b"] });
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith("N-1 a", { duration: 8000 });
  });

  it("aynı yanıt nesnesi iki kez basılmaz (interceptor + sitedeki açık çağrı)", () => {
    const res = { success: true, warnings: ["N-2 tek"] };
    showServerWarnings(res);
    showServerWarnings(res);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("⭐ aynı METİN 5 sn içinde ikinci kez basılmaz; 5 sn sonra yeniden basılır (tost seli yok)", () => {
    const t0 = 1_000_000;
    showServerWarnings({ warnings: ["N-3 tekrar"] }, t0);
    showServerWarnings({ warnings: ["N-3 tekrar"] }, t0 + 4_999); // yeniden deneme / çift tıklama
    expect(toast.warning).toHaveBeenCalledTimes(1);
    showServerWarnings({ warnings: ["N-3 tekrar"] }, t0 + 5_000);
    expect(toast.warning).toHaveBeenCalledTimes(2);
  });

  it("boş ve metin olmayan notlar basılmaz", () => {
    showServerWarnings({ warnings: ["", "  ", 3, "N-4 gerçek"] });
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("genel basım kararı: yazım yöntemi + bayraksız + zarf", () => {
    const zarf = { success: true, data: {} };
    expect(shouldToastWarnings({ method: "post" }, zarf)).toBe(true);
    expect(shouldToastWarnings({ method: "DELETE" }, zarf)).toBe(true);
    expect(shouldToastWarnings({ method: "get" }, zarf)).toBe(false);
    expect(shouldToastWarnings({ method: "post", serverWarnings: "handled" }, zarf)).toBe(false);
    expect(shouldToastWarnings({ method: "post", serverWarnings: "silent" }, zarf)).toBe(false);
    expect(shouldToastWarnings({ method: "post" }, { ok: false, warnings: ["x"] })).toBe(false);
  });

  it("anlamlı mesaj varsa o, yoksa istemcinin cümlesi", () => {
    expect(serverSuccessText({ message: "Sevk edildi · taslak açıldı" }, "Sevk edildi.")).toBe("Sevk edildi · taslak açıldı");
    expect(serverSuccessText({ message: "  " }, "Sevk edildi.")).toBe("Sevk edildi.");
    expect(serverSuccessText(undefined, "Kaydedildi.")).toBe("Kaydedildi.");
    toastServerSuccess({}, "Kaydedildi.", { duration: 5000 });
    expect(toast.success).toHaveBeenCalledWith("Kaydedildi.", { duration: 5000 });
  });
});
