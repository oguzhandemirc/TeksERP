// BEKÇİ — tedarikçi seçici saf katmanı (v3): rol → bacak/parametre · sayfa token geçişleri · satır eşlemesi
import { describe, it, expect } from "vitest";
import { SUPPLIER_ROLE_FILTER_OPTIONS, SUPPLIER_ROLE_LABEL, customerRow, firstPageToken, legsFor, nextPageToken, subcontractorRow, type PickerPage } from "./supplierPicker";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { companyTypeLabels } from "@/types/enums";

const page = (token: PickerPage["token"], next: PickerPage["next"] = null, error = false): PickerPage => ({ token, rows: [], next, error });

describe("supplierPicker (saf)", () => {
  it("⭐ rol → bacak: ALL iki bacak filtresiz · Fason yalnız fason · cari rolleri yalnız cari + filter[type]", () => {
    expect(legsFor("ALL")).toEqual({ customers: true, subs: true });
    expect(legsFor("SUBCONTRACTOR")).toEqual({ customers: false, subs: true });
    expect(legsFor("SUPPLIER")).toEqual({ customers: true, subs: false, customerType: "SUPPLIER" });
    expect(firstPageToken("ALL")).toEqual({ leg: "customers", cursor: null });
    expect(firstPageToken("SUBCONTRACTOR")).toEqual({ leg: "subs", page: 1 });
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Tedarikçi", "Müşteri + Tedarikçi", "Fason"]);
  });

  it("⭐ cari tipi etiketleri TEK kaynaktan (`companyTypeLabels`) — kopyaya yazılan literal sapamaz", () => {
    expect(SUPPLIER_ROLE_LABEL.CUSTOMER).toBe(companyTypeLabels.CUSTOMER);
    expect(SUPPLIER_ROLE_LABEL.SUPPLIER).toBe(companyTypeLabels.SUPPLIER);
    expect(SUPPLIER_ROLE_LABEL.BOTH).toBe(companyTypeLabels.BOTH);
    expect(SUPPLIER_ROLE_LABEL.SUBCONTRACTOR).toBe("Fason");
  });

  it("⭐ token geçişi: aynı bacakta devam → ALL'da cariler bitince fason 1 → fason bitince yok; tek bacak rolde bacak geçişi YOK", () => {
    expect(nextPageToken(page({ leg: "customers", cursor: null }, { leg: "customers", cursor: "c2" }), "ALL")).toEqual({ leg: "customers", cursor: "c2" });
    expect(nextPageToken(page({ leg: "customers", cursor: "c2" }), "ALL")).toEqual({ leg: "subs", page: 1 });
    expect(nextPageToken(page({ leg: "subs", page: 1 }, { leg: "subs", page: 2 }), "ALL")).toEqual({ leg: "subs", page: 2 });
    expect(nextPageToken(page({ leg: "subs", page: 2 }), "ALL")).toBeUndefined();
    expect(nextPageToken(page({ leg: "customers", cursor: null }), "SUPPLIER")).toBeUndefined();
    // hatalı sayfa da geçer: cari bacağı 500 verdiyse ALL'da fason yine istenir
    expect(nextPageToken(page({ leg: "customers", cursor: null }, null, true), "ALL")).toEqual({ leg: "subs", page: 1 });
  });

  it("satır eşlemesi: cari rolü tipten (müşteri-only dahil), fason 'SUBCONTRACTOR'; telefon/vergi no/pasif", () => {
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
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.length).toBe(5);
  });
  it("satır `city` taşır (müşteri kipi Şehir kolonu); fasonda null", () => {
    expect(customerRow({ id: "c1", code: "M", name: "X", type: "CUSTOMER", city: "Bursa" } as Customer).city).toBe("Bursa");
    expect(subcontractorRow({ id: "s1", code: "F", name: "Y" } as Subcontractor).city).toBeNull();
  });
});

