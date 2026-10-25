// Saf form mantığı: son bant boş üst sınır = sınırsız; derece yalnız FACTORY gövdesinde; bant mantığı aynası YOK.
import { describe, expect, it } from "vitest";
import { initialState, missingFields, toBody } from "./ruleSetForm";

const filled = (scope: "FACTORY" | "CUSTOMER") => {
  const s = initialState(null, scope);
  s.name = "Standart";
  s.customerId = scope === "CUSTOMER" ? "c1" : null;
  s.bands = [
    { key: "a", maxScore: "20,5", label: "A", accepted: true, qualityGradeId: scope === "FACTORY" ? "g1" : null },
    { key: "b", maxScore: "", label: "B", accepted: false, qualityGradeId: scope === "FACTORY" ? "g2" : null },
  ];
  return s;
};

describe("ruleSetForm", () => {
  it("son bandın üst sınırı boş = sınırsız: eksik sayılmaz, gövdeye null gider; virgül noktaya döner", () => {
    const s = filled("FACTORY");
    expect(missingFields(s)).toEqual([]);
    const body = toBody(s);
    expect(body.bands.map((b) => b.maxScore)).toEqual(["20.5", null]);
    expect(body.bands.map((b) => b.sortOrder)).toEqual([0, 1]);
  });
  it("ara bandın üst sınırı boşsa eksik; FACTORY'de derece zorunlu", () => {
    const s = filled("FACTORY");
    s.bands[0]!.maxScore = "";
    s.bands[1]!.qualityGradeId = null;
    expect(missingFields(s)).toEqual(["1. bant üst sınırı", "2. bant kalite derecesi"]);
  });
  it("CUSTOMER gövdesinde qualityGradeId anahtarı YOK, müşteri zorunlu", () => {
    const s = filled("CUSTOMER");
    const body = toBody(s);
    expect(body.bands.every((b) => !("qualityGradeId" in b))).toBe(true);
    expect(body).toMatchObject({ scope: "CUSTOMER", customerId: "c1", itemId: null });
    s.customerId = null;
    expect(missingFields(s)).toContain("Müşteri");
  });
  it("istemci bant sırası/eşik artışını DOĞRULAMAZ (sunucu `validateBands`)", () => {
    const s = filled("FACTORY");
    s.bands = [{ ...s.bands[0]!, maxScore: "50" }, { ...s.bands[1]!, maxScore: "10" }, { key: "c", maxScore: "", label: "C", accepted: false, qualityGradeId: "g3" }];
    expect(missingFields(s)).toEqual([]);
  });
});
