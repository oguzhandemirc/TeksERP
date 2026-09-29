import { describe, it, expect } from "vitest";
import { licenseModuleKey, licenseModuleLabel } from "./ceiling";

/** 403 LICENSE_MODULE `details.modul`: tek biçim DB anahtarı (`finance.enabled`); eski API alanı da tanınır. */
describe("licenseModuleKey", () => {
  it("DB anahtarı aynen, eski API alanı DB anahtarına çevrilir", () => {
    expect(licenseModuleKey({ modul: "finance.enabled" })).toBe("finance.enabled");
    expect(licenseModuleKey({ modul: "financeEnabled" })).toBe("finance.enabled");
    expect(licenseModuleLabel("finance.enabled")).toBeTruthy();
  });
  it("tanınmayan / eksik → null; ad da null", () => {
    expect(licenseModuleKey({ modul: "patron-bulut" })).toBeNull();
    expect(licenseModuleKey({})).toBeNull();
    expect(licenseModuleKey(null)).toBeNull();
    expect(licenseModuleLabel(null)).toBeNull();
  });
});
