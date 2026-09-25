import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  SERVER_WARNINGS_HANDLED,
  serverSuccessText,
  showMutationWarnings,
  showServerWarnings,
  toastServerSuccess,
} from "./serverNotes";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

describe("serverNotes — sunucu notlarının tek kaynağı", () => {
  beforeEach(() => vi.clearAllMocks());

  it("genel basım: zarfın her uyarısı ayrı toast.warning, 8 sn", () => {
    showMutationWarnings({ success: true, data: {}, warnings: ["a", "b"] }, undefined);
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith("a", { duration: 8000 });
  });

  it("meta işaretli mutation genel basımdan atlanır (uyarıyı kendi gösterir)", () => {
    showMutationWarnings({ success: true, data: {}, warnings: ["a"] }, SERVER_WARNINGS_HANDLED);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("zarf OLMAYAN nesnenin `warnings` alanı uyarı sayılmaz", () => {
    showMutationWarnings({ ok: false, warnings: ["süpürme hatası"] }, undefined);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("aynı yanıt iki kez basılmaz (genel basım + sitedeki açık çağrı)", () => {
    const res = { success: true, data: {}, warnings: ["tek"] };
    showMutationWarnings(res, undefined);
    showServerWarnings(res);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("boş ve metin olmayan notlar basılmaz", () => {
    showServerWarnings({ warnings: ["", "  ", 3, "gerçek"] });
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("anlamlı mesaj varsa o, yoksa istemcinin cümlesi", () => {
    expect(serverSuccessText({ message: "Sevk edildi · taslak açıldı" }, "Sevk edildi.")).toBe("Sevk edildi · taslak açıldı");
    expect(serverSuccessText({ message: "  " }, "Sevk edildi.")).toBe("Sevk edildi.");
    expect(serverSuccessText(undefined, "Kaydedildi.")).toBe("Kaydedildi.");
    toastServerSuccess({}, "Kaydedildi.", { duration: 5000 });
    expect(toast.success).toHaveBeenCalledWith("Kaydedildi.", { duration: 5000 });
  });
});
