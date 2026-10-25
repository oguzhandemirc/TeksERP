// Saf kurallar: süzgeç → sorgu parametresi, konumsuz hata null, "—" görüntüsü.
import { describe, expect, it } from "vitest";
import { EMPTY_INSPECTION_FILTERS, decimalInput, defectRowProblem, defectsPayload, filtersFromSearch, numText, toListParams } from "./inspectionRules";

describe("inspectionRules", () => {
  it("her süzgeç sorgu parametresine gider (istemci satır süzmez)", () => {
    const p = toListParams({
      ...EMPTY_INSPECTION_FILTERS, q: " TP-1 ", from: "2026-10-01", to: "2026-10-25", itemId: "i", gradeId: "g", stationId: "s",
      inspectedById: "u", phase: "FINAL", minScore: "10,5", maxScore: "40", widthUnknown: true, mismatch: true, batchId: "b",
    });
    expect(p).toMatchObject({ q: "TP-1", from: "2026-10-01", to: "2026-10-25", itemId: "i", gradeId: "g", stationId: "s", inspectedById: "u", phase: "FINAL", minScore: "10.5", maxScore: "40", widthUnknown: "1", mismatch: "1", batchId: "b", includeHistory: "" });
  });
  it("biçimsiz puan gönderilmez", () => {
    expect(toListParams({ ...EMPTY_INSPECTION_FILTERS, minScore: "abc" }).minScore).toBe("");
    expect(decimalInput("")).toBeNull();
    expect(decimalInput("1,25")).toBe("1.25");
    expect(decimalInput("x")).toBeUndefined();
  });
  it("boş metre null gider, 0 DEĞİL; türsüz satır sorunlu", () => {
    const rows = [{ key: "a", defectTypeId: "t", sizeClass: null, startMeter: "" }, { key: "b", defectTypeId: "t", sizeClass: "IN_3_TO_6" as const, startMeter: "0" }];
    expect(defectsPayload(rows)).toEqual([{ defectTypeId: "t", sizeClass: null, startMeter: null }, { defectTypeId: "t", sizeClass: "IN_3_TO_6", startMeter: "0" }]);
    expect(defectRowProblem({ key: "c", defectTypeId: "", sizeClass: null, startMeter: "" })).toBe("Hata türü seçilmedi");
  });
  it("null sayı '—'; URL bağlamı süzgece döner", () => {
    expect(numText(null)).toBe("—");
    expect(numText("")).toBe("—");
    const f = filtersFromSearch(new URLSearchParams("rollId=r1&rollLabel=TP-9&batchId=b1"));
    expect([f.rollId, f.rollLabel, f.batchId]).toEqual(["r1", "TP-9", "b1"]);
  });
});
