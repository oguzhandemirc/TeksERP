import { describe, expect, it } from "vitest";
import { allocationFieldVisible, buildAllocationBody, draftBlocksSave, emptyAllocationDraft, parseSharePct, shareHint } from "./allocationRules";

describe("masraf bağı kuralları (D4-H3)", () => {
  it("pay: 0 < x ≤ 100, en çok 2 ondalık, virgül kabul", () => {
    expect(parseSharePct("12,5")).toBe("12.5");
    expect(parseSharePct("100")).toBe("100");
    expect(parseSharePct("0")).toBeNull();
    expect(parseSharePct("100.01")).toBeNull();
    expect(parseSharePct("1.234")).toBeNull();
    expect(parseSharePct("abc")).toBeNull();
    expect(shareHint("")).toBe("Pay (%) yazın.");
    expect(shareHint("50")).toBeNull();
  });

  it("gövde: tam olarak bir hedef alanı; taslak eksikse null (bağsız kayıt)", () => {
    expect(buildAllocationBody(emptyAllocationDraft())).toBeNull();
    expect(buildAllocationBody({ targetType: "MACHINE", targetId: "m", sharePct: "40" })).toEqual({ machineId: "m", sharePct: "40" });
    expect(buildAllocationBody({ targetType: "WORK_ORDER", targetId: "w", sharePct: "100" })).toEqual({ workOrderId: "w", sharePct: "100" });
    expect(buildAllocationBody({ targetType: "SERVICE_ITEM", targetId: "s", sharePct: "5,25" })).toEqual({ serviceItemId: "s", sharePct: "5.25" });
  });

  it("hedef seçili + bozuk pay kaydı durdurur; hedefsiz taslak durdurmaz", () => {
    expect(draftBlocksSave({ targetType: "MACHINE", targetId: "m", sharePct: "150" })).toBe(true);
    expect(draftBlocksSave({ targetType: "MACHINE", targetId: null, sharePct: "150" })).toBe(false);
    expect(draftBlocksSave(null)).toBe(false);
  });

  it("alan yalnız OPTIONAL + masrafta görünür (OFF'ta form bayt-aynı)", () => {
    expect(allocationFieldVisible("OPTIONAL", "EXPENSE")).toBe(true);
    expect(allocationFieldVisible("OFF", "EXPENSE")).toBe(false);
    expect(allocationFieldVisible(undefined, "EXPENSE")).toBe(false);
    expect(allocationFieldVisible("OPTIONAL", "INCOME")).toBe(false);
  });
});
