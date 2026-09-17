// BEKÇİ — tedarikçi seçici saf katmanı (v3): rol → bacak/parametre · sayfa token geçişleri · satır eşlemesi
import { describe, it, expect } from "vitest";
import { CUSTOMER_ROLE_FILTER_OPTIONS, SUPPLIER_ALL_CUSTOMER_TYPES, SUPPLIER_ROLE_FILTER_OPTIONS, SUPPLIER_ROLE_LABEL, UNLINKED_SUBCONTRACTOR_FILTER, customerRow, firstPageToken, legsFor, nextPageToken, roleFilterOptions, roleTriggerText, rowRoleLabel, subcontractorRow, type PickerPage } from "./supplierPicker";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { companyTypeLabels } from "@/types/enums";

const page = (token: PickerPage["token"], next: PickerPage["next"] = null, error = false): PickerPage => ({ token, rows: [], next, error });

describe("supplierPicker (saf)", () => {
  it("⭐ rol → bacak: ALL = cari bacağı CSV `SUPPLIER,BOTH` + fason · Fason yalnız fason · cari rolleri yalnız cari + filter[type]", () => {
    expect(SUPPLIER_ALL_CUSTOMER_TYPES).toBe("SUPPLIER,BOTH");
    expect(legsFor("ALL")).toEqual({ customers: true, subs: true, customerType: "SUPPLIER,BOTH" });
    expect(legsFor("SUBCONTRACTOR")).toEqual({ customers: false, subs: true });
    expect(legsFor("SUPPLIER")).toEqual({ customers: true, subs: false, customerType: "SUPPLIER" });
    expect(legsFor("BOTH")).toEqual({ customers: true, subs: false, customerType: "BOTH" });
    expect(firstPageToken("ALL")).toEqual({ leg: "customers", cursor: null, type: "SUPPLIER,BOTH" });
    expect(firstPageToken("SUBCONTRACTOR")).toEqual({ leg: "subs", page: 1 });
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Tedarikçi", "Müşteri + Tedarikçi", "Fason"]);
  });

  it("⭐ tedarikçi kipi CUSTOMER tipini HİÇBİR yoldan sormaz: seçeneklerde yok; rol olarak gelirse 'Tümü' gibi (fail-closed)", () => {
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.some((o) => o.value === "CUSTOMER")).toBe(false);
    expect(legsFor("CUSTOMER")).toEqual(legsFor("ALL"));
    for (const role of ["ALL", "CUSTOMER", "SUPPLIER", "BOTH", "SUBCONTRACTOR"] as const) {
      const t = firstPageToken(role);
      expect(t.leg === "customers" ? t.type : "-").not.toBe("CUSTOMER");
    }
  });

  it("dönüştürme görünümü (`customer-only`): yalnız cari bacağı, type=CUSTOMER, fason yok, bacak geçişi yok", () => {
    expect(legsFor("ALL", "customer-only")).toEqual({ customers: true, subs: false, customerType: "CUSTOMER" });
    expect(firstPageToken("ALL", "customer-only")).toEqual({ leg: "customers", cursor: null, type: "CUSTOMER" });
    expect(nextPageToken(page({ leg: "customers", cursor: null, type: "CUSTOMER" }), "ALL", "customer-only")).toBeUndefined();
  });

  it("süzgeç tetiği kapalıyken adını taşır: 'Rol: Tümü' / 'Rol: Tedarikçi' (seçenek metni 'Tümü' kalır)", () => {
    expect(roleTriggerText("supplier", "ALL")).toBe("Rol: Tümü");
    expect(roleTriggerText("supplier", "SUPPLIER")).toBe("Rol: Tedarikçi");
    expect(roleTriggerText("customer", "BOTH")).toBe("Rol: Müşteri + Tedarikçi");
    expect(SUPPLIER_ROLE_FILTER_OPTIONS[0]!.label).toBe("Tümü");
  });

  it("⭐ cari tipi etiketleri TEK kaynaktan (`companyTypeLabels`) — kopyaya yazılan literal sapamaz", () => {
    expect(SUPPLIER_ROLE_LABEL.CUSTOMER).toBe(companyTypeLabels.CUSTOMER);
    expect(SUPPLIER_ROLE_LABEL.SUPPLIER).toBe(companyTypeLabels.SUPPLIER);
    expect(SUPPLIER_ROLE_LABEL.BOTH).toBe(companyTypeLabels.BOTH);
    expect(SUPPLIER_ROLE_LABEL.SUBCONTRACTOR).toBe("Fason");
  });

  it("⭐ token geçişi: aynı bacakta devam → ALL'da cariler bitince fason 1 → fason bitince yok; tek bacak rolde bacak geçişi YOK", () => {
    expect(nextPageToken(page({ leg: "customers", cursor: null, type: "SUPPLIER,BOTH" }, { leg: "customers", cursor: "c2", type: "SUPPLIER,BOTH" }), "ALL")).toEqual({ leg: "customers", cursor: "c2", type: "SUPPLIER,BOTH" });
    expect(nextPageToken(page({ leg: "customers", cursor: "c2", type: "SUPPLIER,BOTH" }), "ALL")).toEqual({ leg: "subs", page: 1 });
    expect(nextPageToken(page({ leg: "subs", page: 1 }, { leg: "subs", page: 2 }), "ALL")).toEqual({ leg: "subs", page: 2 });
    expect(nextPageToken(page({ leg: "subs", page: 2 }), "ALL")).toBeUndefined();
    expect(nextPageToken(page({ leg: "customers", cursor: null }), "SUPPLIER")).toBeUndefined();
    // hatalı sayfa da geçer: cari bacağı 500 verdiyse ALL'da fason yine istenir
    expect(nextPageToken(page({ leg: "customers", cursor: null, type: "SUPPLIER,BOTH" }, null, true), "ALL")).toEqual({ leg: "subs", page: 1 });
  });

  it("satır eşlemesi: cari rolü tipten, fason 'SUBCONTRACTOR'; telefon/vergi no/pasif", () => {
    const c = customerRow({ id: "c1", code: "MUS1", name: "Yalnız Müşteri", type: "CUSTOMER", taxNumber: "111", contactPhone: "0212", isActive: false } as Customer);
    expect(c).toMatchObject({ key: "CUSTOMER:c1", kind: "CUSTOMER", role: "CUSTOMER", taxNumber: "111", phone: "0212", isActive: false });
    const s = subcontractorRow({ id: "s1", code: "FAS1", name: "Boyahane", taxNumber: null, phone: "0532", isActive: true } as Subcontractor);
    expect(s).toMatchObject({ key: "SUBCONTRACTOR:s1", kind: "SUBCONTRACTOR", role: "SUBCONTRACTOR", phone: "0532", taxNumber: null });
  });
});

// Sipariş formu ①: müşteri kipi — yalnız cari, ALL = CUSTOMER bacağı bitince BOTH bacağı; fason yok.
describe("supplierPicker — müşteri kipi", () => {
  it("⭐ ALL: ilk token CUSTOMER tipli cari; cari bitince BOTH; BOTH bitince yok (fason hiç sorulmaz)", () => {
    expect(legsFor("ALL", "customer")).toEqual({ customers: true, subs: false, customerTypes: ["CUSTOMER", "BOTH"] });
    expect(firstPageToken("ALL", "customer")).toEqual({ leg: "customers", cursor: null, type: "CUSTOMER" });
    expect(nextPageToken(page({ leg: "customers", cursor: null, type: "CUSTOMER" }), "ALL", "customer")).toEqual({ leg: "customers", cursor: null, type: "BOTH" });
    expect(nextPageToken(page({ leg: "customers", cursor: "x", type: "BOTH" }), "ALL", "customer")).toBeUndefined();
    expect(firstPageToken("BOTH", "customer")).toEqual({ leg: "customers", cursor: null, type: "BOTH" });
    expect(CUSTOMER_ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Müşteri + Tedarikçi"]);
  });
  it("satır `city` taşır (müşteri kipi Şehir kolonu); fasonda null", () => {
    expect(customerRow({ id: "c1", code: "M", name: "X", type: "CUSTOMER", city: "Bursa" } as Customer).city).toBe("Bursa");
    expect(subcontractorRow({ id: "s1", code: "F", name: "Y" } as Subcontractor).city).toBeNull();
  });
});

// Fason = carinin rolü (2026-09-17): bağlı fason cari satırında TEK kez; fason bacağı yalnız bağsız; yalnız-cari liste.
describe("supplierPicker — fason = carinin rolü", () => {
  it("⭐ cari satırı AKTİF fason profiliyle 'Tedarikçi · Fason' rozeti taşır; pasif profil rol değildir; fason satırı düz 'Fason'", () => {
    const bagli = customerRow({ id: "c1", code: "T", name: "X", type: "SUPPLIER", subcontractor: { id: "s1", isActive: true } } as Customer);
    expect(bagli.hasSubcontractorProfile).toBe(true);
    expect(rowRoleLabel(bagli)).toBe("Tedarikçi · Fason");
    expect(bagli.kind).toBe("CUSTOMER");
    const pasif = customerRow({ id: "c2", code: "T", name: "Y", type: "BOTH", subcontractor: { id: "s2", isActive: false } } as Customer);
    expect(rowRoleLabel(pasif)).toBe("Müşteri + Tedarikçi");
    expect(rowRoleLabel(customerRow({ id: "c3", code: "T", name: "Z", type: "SUPPLIER" } as Customer))).toBe("Tedarikçi");
    expect(rowRoleLabel(subcontractorRow({ id: "s9", code: "F", name: "B" } as Subcontractor))).toBe("Fason");
  });
  it("⭐ fason bacağı süzgeci `filter[customerId]=null` — bağlı fason ikinci kez listelenmez", () => {
    expect(UNLINKED_SUBCONTRACTOR_FILTER).toEqual({ customerId: "null" });
  });
  it("yalnız-cari liste (`supplier-cari`): fason bacağı yok, ALL = SUPPLIER,BOTH, rol seçeneklerinde Fason yok", () => {
    expect(legsFor("ALL", "supplier-cari")).toEqual({ customers: true, subs: false, customerType: "SUPPLIER,BOTH" });
    expect(legsFor("BOTH", "supplier-cari")).toEqual({ customers: true, subs: false, customerType: "BOTH" });
    expect(legsFor("SUBCONTRACTOR", "supplier-cari")).toEqual({ customers: true, subs: false, customerType: "SUPPLIER,BOTH" });
    expect(nextPageToken(page({ leg: "customers", cursor: null, type: "SUPPLIER,BOTH" }), "ALL", "supplier-cari")).toBeUndefined();
    expect(roleFilterOptions("supplier-cari").map((o) => o.label)).toEqual(["Tümü", "Tedarikçi", "Müşteri + Tedarikçi"]);
    expect(roleTriggerText("supplier-cari", "ALL")).toBe("Rol: Tümü");
  });
});
