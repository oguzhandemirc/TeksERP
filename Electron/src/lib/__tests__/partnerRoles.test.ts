// =============================================================================
// BEKÇİ — iş ortağı rolleri saf katmanı: etiket/rozet · Yön × Fason → sunucu süzgeci · seçici bacak süzgeci
// =============================================================================
// TEK KAYNAK: Cariler şeridi (`carilerPaging`) ve tedarikçi/müşteri seçicisi (`supplierPicker.legsFor`) bu
// dosyadan okur. Negatif sonda (kırmızı görüldü): `directionFilters("BOTH")` `filter[role]=customer,supplier`
// (OR) dönünce "iki bayrağı da taşıyan" kolu ❌; `pickerCustomerFilters("supplier","SUPPLIER")`ten
// `isCustomerRole:"false"` düşünce "yalnız tedarikçi" kolu ❌.
import { describe, it, expect } from "vitest";
import { DIRECTION_OPTIONS, SUBCONTRACTOR_OPTIONS, directionFilters, partnerRoleBadges, partnerRoleLabels, partnerRoleText, pickerCustomerFilters, subcontractorFilters } from "../partnerRoles";

describe("partnerRoles — etiket ve rozet", () => {
  it("rozetler bayrak başına, sabit sırada; rolsüz '—'", () => {
    expect(partnerRoleBadges({ isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true })).toEqual(["Müşteri", "Tedarikçi", "Fason"]);
    expect(partnerRoleBadges({ isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: false })).toEqual(["Tedarikçi"]);
    expect(partnerRoleText({ isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: true })).toBe("Müşteri · Fason");
    expect(partnerRoleText(null)).toBe("—");
    expect(partnerRoleLabels).toEqual({ customer: "Müşteri", supplier: "Tedarikçi", subcontractor: "Fason" });
  });
  it("şerit seçenekleri: Yön Tümü·Müşteri·Tedarikçi·Müşteri + Tedarikçi; Fason Tümü·Fason yapan·Yapmayan", () => {
    expect(DIRECTION_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Tedarikçi", "Müşteri + Tedarikçi"]);
    expect(SUBCONTRACTOR_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Fason yapan", "Yapmayan"]);
  });
});

describe("partnerRoles — Yön × Fason → sunucu süzgeci (Cariler şeridi)", () => {
  it("⭐ Müşteri/Tedarikçi → filter[role] (rolü olan hepsi); Müşteri + Tedarikçi → İKİ bayrak da true (skaler AND, OR değil); Tümü → yok", () => {
    expect(directionFilters("CUSTOMER")).toEqual({ role: "customer" });
    expect(directionFilters("SUPPLIER")).toEqual({ role: "supplier" });
    expect(directionFilters("BOTH")).toEqual({ isCustomerRole: "true", isSupplierRole: "true" });
    expect(directionFilters("BOTH")).not.toHaveProperty("role");
    expect(directionFilters("ALL")).toEqual({});
  });
  it("Fason yapan/yapmayan → isSubcontractorRole true/false; Tümü → yok", () => {
    expect(subcontractorFilters("YES")).toEqual({ isSubcontractorRole: "true" });
    expect(subcontractorFilters("NO")).toEqual({ isSubcontractorRole: "false" });
    expect(subcontractorFilters("ALL")).toEqual({});
  });
});

describe("partnerRoles — seçici cari bacağı", () => {
  it("⭐ tedarikçi kipi: Tümü = tedarikçi rolü olan hepsi; Tedarikçi = YALNIZ tedarikçi (müşteri rolü false); Müşteri + Tedarikçi = ikisi", () => {
    expect(pickerCustomerFilters("supplier", "ALL")).toEqual({ isSupplierRole: "true" });
    expect(pickerCustomerFilters("supplier", "SUPPLIER")).toEqual({ isSupplierRole: "true", isCustomerRole: "false" });
    expect(pickerCustomerFilters("supplier", "BOTH")).toEqual({ isCustomerRole: "true", isSupplierRole: "true" });
    // Tedarikçi kipinde "Müşteri" seçeneği yok — gelirse Tümü gibi (fail-closed: müşteri-only asla).
    expect(pickerCustomerFilters("supplier", "CUSTOMER")).toEqual({ isSupplierRole: "true" });
  });
  it("⭐ müşteri kipi: Tümü = müşteri rolü olan hepsi; Müşteri = YALNIZ müşteri; Müşteri + Tedarikçi = ikisi; 'type' HİÇ yok", () => {
    expect(pickerCustomerFilters("customer", "ALL")).toEqual({ isCustomerRole: "true" });
    expect(pickerCustomerFilters("customer", "CUSTOMER")).toEqual({ isCustomerRole: "true", isSupplierRole: "false" });
    expect(pickerCustomerFilters("customer", "BOTH")).toEqual({ isCustomerRole: "true", isSupplierRole: "true" });
    for (const m of ["supplier", "customer"] as const) for (const r of ["ALL", "CUSTOMER", "SUPPLIER", "BOTH"] as const) expect(pickerCustomerFilters(m, r)).not.toHaveProperty("type");
  });
});
