import { describe, expect, it } from "vitest";
import { canCreateServicePeriodDraft, defaultServicePeriod, isValidServicePeriod, recentServicePeriods, servicePeriodLabel } from "./servicePeriodDraft";

describe("dönem sonu hizmet faturası yardımcıları (H8)", () => {
  it("varsayılan dönem bir önceki fabrika ayıdır; ocakta önceki yılın aralığı", () => {
    expect(defaultServicePeriod(new Date("2026-10-15T09:00:00Z"))).toBe("2026-09");
    expect(defaultServicePeriod(new Date("2026-01-10T09:00:00Z"))).toBe("2025-12");
  });
  it("dönem biçimi YYYY-AA", () => {
    expect(isValidServicePeriod("2026-10")).toBe(true);
    expect(isValidServicePeriod("2026-13")).toBe(false);
    expect(isValidServicePeriod("")).toBe(false);
  });
  it("etiket Türkçe ay adı", () => {
    expect(servicePeriodLabel("2026-10")).toBe("Ekim 2026");
  });
  it("oluştur yalnız iş varken ve dönem açıkken", () => {
    expect(canCreateServicePeriodDraft(undefined)).toBe(false);
    expect(canCreateServicePeriodDraft({ workCount: 0, periodClosed: null })).toBe(false);
    expect(canCreateServicePeriodDraft({ workCount: 2, periodClosed: "2026-10-31" })).toBe(false);
    expect(canCreateServicePeriodDraft({ workCount: 2, periodClosed: null })).toBe(true);
  });
  it("seçilebilir dönemler bu aydan geriye, yıl sınırını geçer", () => {
    const list = recentServicePeriods(new Date("2026-02-10T09:00:00Z"), 4);
    expect(list).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
});
