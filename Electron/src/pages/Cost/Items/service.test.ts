// İstemci gövde katmanı sessiz allowlist: liste süzgeci `filter[durum]` biçiminde gider (sunucu çıplak adı 400
// yapar); yapı gövdesi yalnız bilinen alanları taşır, boş alan null (= parametre varsayılanı).
import { describe, expect, it } from "vitest";
import { buildStructureBody, listParams, STRUCTURE_KEYS, type StructureBody } from "./service";

describe("Maliyet kartları servisi", () => {
  it("liste parametreleri: süzgeç filter[durum], boş arama gitmez", () => {
    expect(listParams({ q: "  ", durum: "TAM", girdiDegisti: false }, null, 50)).toEqual({ "filter[durum]": "TAM", limit: "50" });
    expect(listParams({ q: "poplin", durum: "", girdiDegisti: true }, "c1", 20)).toEqual({ q: "poplin", girdiDegisti: "1", cursor: "c1", limit: "20" });
  });
  it("yapı gövdesi tam küme ve yalnız bilinen alanlar", () => {
    const body = buildStructureBody({ loomRpm: "650", hack: "x" } as unknown as StructureBody);
    expect(Object.keys(body).sort()).toEqual([...STRUCTURE_KEYS, "finishingRateCode", "extraCostLabel", "notes"].sort());
    expect(body.loomRpm).toBe("650");
    expect(body.efficiencyPct).toBeNull();
  });
  it("ek işlemler: verilmezse gövdeye girmez (sunucu dokunmaz), verilirse sıralı liste", () => {
    const base = buildStructureBody({} as StructureBody);
    expect("processes" in base).toBe(false);
    expect(buildStructureBody({ processes: ["KURSUN-DIS", "", "DEVERE"] } as unknown as StructureBody).processes).toEqual(["KURSUN-DIS", "DEVERE"]);
    expect(buildStructureBody({ processes: [] } as unknown as StructureBody).processes).toEqual([]);
  });
});
