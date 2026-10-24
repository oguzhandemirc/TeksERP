import { describe, expect, it } from "vitest";
import { defectTypeFormDefaults, defectTypeFormSchema } from "./schema";
import { defectGroupLabel } from "@/lib/hata-gruplari";

const base = { ...defectTypeFormDefaults, name: "Delik" };

describe("hata tipi formu — hata grubu", () => {
  it("varsayılan gruplanmamış (boş) ve geçerli", () => {
    expect(defectTypeFormDefaults.defectGroup).toBe("");
    expect(defectTypeFormSchema.safeParse(base).success).toBe(true);
  });
  it("kümedeki grubu kabul eder", () => {
    expect(defectTypeFormSchema.safeParse({ ...base, defectGroup: "COZGU" }).success).toBe(true);
  });
  it("küme dışı grubu reddeder", () => {
    expect(defectTypeFormSchema.safeParse({ ...base, defectGroup: "XYZ" }).success).toBe(false);
  });
  it("liste etiketi: null → Gruplanmamış, kod → Türkçe ad", () => {
    expect(defectGroupLabel(null)).toBe("Gruplanmamış");
    expect(defectGroupLabel("ATKI")).toBe("Atkı");
  });
});
