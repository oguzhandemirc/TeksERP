// =============================================================================
// Cari kilidi ayar satırları (D4-I1a, 2026-10-30)
// =============================================================================
// Backend: `finance.cariHold.defaultScope` (7 alt küme, varsayılan INTAKE,SHIPMENT) ve
// `finance.cariHold.releaseBySamePerson` (ALLOW | DENY, varsayılan ALLOW). Panel satırı backend
// Zod enum'unun ve varsayılanının AYNASIDIR; ayrışırsa panel geçerli değeri yazamaz (400).
// Backend tarafı: `Teks-Erp/scripts/test_cari_kilit.ts` §6.
// =============================================================================
import { describe, it, expect } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const finance = SETTINGS_CATEGORIES.find((c) => c.id === "finance");

describe("Cari kilidi ayar satırları", () => {
  it("kapsam ön seçimi: INTAKE,SHIPMENT varsayılan, boş olmayan 7 alt küme, Cari kilidi grubunda", () => {
    const row = finance?.enumFlags?.find((r) => r.enumKey === "financeCariHoldDefaultScope");
    expect(row).toBeDefined();
    expect(row?.defaultValue).toBe("INTAKE,SHIPMENT");
    expect(row?.options.map((o) => o.value)).toEqual([
      "INTAKE,SHIPMENT",
      "INTAKE",
      "SHIPMENT",
      "INVOICE",
      "INTAKE,INVOICE",
      "SHIPMENT,INVOICE",
      "INTAKE,SHIPMENT,INVOICE",
    ]);
    expect(row?.group).toBe("Cari kilidi");
  });

  it("açma kuralı: ALLOW varsayılan, ALLOW/DENY", () => {
    const row = finance?.enumFlags?.find((r) => r.enumKey === "financeCariHoldReleaseBySamePerson");
    expect(row).toBeDefined();
    expect(row?.defaultValue).toBe("ALLOW");
    expect(row?.options.map((o) => o.value)).toEqual(["ALLOW", "DENY"]);
    expect(row?.title).toBe("Cari kilidini koyan kişi kendisi açabilsin");
  });

  it("iki satır da ön muhasebe modülüne bağlı", () => {
    for (const k of ["financeCariHoldDefaultScope", "financeCariHoldReleaseBySamePerson"] as const) {
      expect(FLAG_MODULE[k]).toBe("financeEnabled");
    }
  });
});

describe("Kilitli caride emanet sevki ayarı (D4-I1c)", () => {
  const row = finance?.enumFlags?.find((r) => r.enumKey === "financeCariHoldEmanetShipment");

  it("EXEMPT varsayılan (bugünkü), üç seçenek backend Zod sırasıyla, Cari kilidi grubunda", () => {
    expect(row).toBeDefined();
    expect(row?.defaultValue).toBe("EXEMPT");
    expect(row?.options.map((o) => o.value)).toEqual(["EXEMPT", "PROCESSED_HELD", "ALL_HELD"]);
    expect(row?.group).toBe("Cari kilidi");
    expect(FLAG_MODULE.financeCariHoldEmanetShipment).toBe("financeEnabled");
  });

  it("açıklama hukuki teyit notunu taşır", () => {
    expect(row?.desc).toMatch(/hapis hakkı/);
    expect(row?.desc).toMatch(/hukuki teyit/);
  });
});
