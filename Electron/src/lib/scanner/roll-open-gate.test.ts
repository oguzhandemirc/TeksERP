// Kumaş Stoğu "Aç" kapısı: müşteri kodu (serisiz, ör. HH-2611-00001) ayar açıkken kabul edilir;
// çözüm backend tarama çözücüsündedir (Gülkesim prova bulgusu).
import { describe, expect, it } from "vitest";
import { canOpenRollDetail } from "./roll-open-gate";

describe("canOpenRollDetail", () => {
  it("tam biçimli top barkodu ayardan bağımsız açılır", () => {
    expect(canOpenRollDetail("T311026H0001", false)).toBe(true);
    expect(canOpenRollDetail("T311026H0001", true)).toBe(true);
  });
  it("müşteri kodu yalnız müşteri kodu okuma ayarı açıkken", () => {
    expect(canOpenRollDetail("HH-2611-00001", true)).toBe(true);
    expect(canOpenRollDetail(" HH-2611-00001 ", true)).toBe(true);
    expect(canOpenRollDetail("HH-2611-00001", false)).toBe(false);
  });
  it("kumaş adı, rakamsız metin ve başka serinin kodu açılmaz", () => {
    expect(canOpenRollDetail("TÜL BEYAZ", true)).toBe(false);
    expect(canOpenRollDetail("TULBEYAZ", true)).toBe(false);
    expect(canOpenRollDetail("CV3110260001", true)).toBe(false);
    expect(canOpenRollDetail("SVK3110260001", true)).toBe(false);
    expect(canOpenRollDetail("", true)).toBe(false);
  });
});
