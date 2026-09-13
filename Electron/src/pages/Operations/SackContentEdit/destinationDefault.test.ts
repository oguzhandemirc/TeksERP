import { describe, expect, it } from "vitest";
import { resolveDestination } from "./destinationDefault";

describe("resolveDestination — cari varsayılanı kilit değil", () => {
  it("dokunulmadı + müşteri EXPORT → EXPORT ile başlar", () => {
    expect(resolveDestination({ current: "DOMESTIC", touched: false, customerDefault: "EXPORT" })).toBe("EXPORT");
  });
  it("dokunulmadı + müşteride varsayılan yok → bugünkü davranış (DOMESTIC)", () => {
    expect(resolveDestination({ current: "DOMESTIC", touched: false, customerDefault: null })).toBe("DOMESTIC");
    expect(resolveDestination({ current: "DOMESTIC", touched: false, customerDefault: undefined })).toBe("DOMESTIC");
  });
  it("⭐ operatör DOMESTIC seçti, müşteri EXPORT varsayılanlı → seçim EZİLMEZ", () => {
    expect(resolveDestination({ current: "DOMESTIC", touched: true, customerDefault: "EXPORT" })).toBe("DOMESTIC");
  });
  it("⭐ dokunma geri dönülmez: EXPORT'a çevirip DOMESTIC'e döndü, müşteri değişti → DOMESTIC kalır", () => {
    // touched bir kez true olduysa customerDefault ne olursa olsun current kazanır.
    expect(resolveDestination({ current: "DOMESTIC", touched: true, customerDefault: "EXPORT" })).toBe("DOMESTIC");
    expect(resolveDestination({ current: "EXPORT", touched: true, customerDefault: null })).toBe("EXPORT");
  });
});
