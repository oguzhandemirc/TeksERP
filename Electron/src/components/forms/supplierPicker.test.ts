// BEKÇİ — tedarikçi seçici saf katmanı (v3): rol → bacak/parametre · sayfa token geçişleri · satır eşlemesi
import { describe, it, expect } from "vitest";
import { SUPPLIER_ROLE_FILTER_OPTIONS, customerRow, firstPageToken, legsFor, nextPageToken, subcontractorRow, type PickerPage } from "./supplierPicker";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";

const page = (token: PickerPage["token"], next: PickerPage["next"] = null, error = false): PickerPage => ({ token, rows: [], next, error });

describe("supplierPicker (saf)", () => {
  it("⭐ rol → bacak: ALL iki bacak filtresiz · Fason yalnız fason · cari rolleri yalnız cari + filter[type]", () => {
    expect(legsFor("ALL")).toEqual({ customers: true, subs: true });
    expect(legsFor("SUBCONTRACTOR")).toEqual({ customers: false, subs: true });
    expect(legsFor("SUPPLIER")).toEqual({ customers: true, subs: false, customerType: "SUPPLIER" });
    expect(firstPageToken("ALL")).toEqual({ leg: "customers", cursor: null });
    expect(firstPageToken("SUBCONTRACTOR")).toEqual({ leg: "subs", page: 1 });
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Tedarikçi", "Alıcı + Satıcı", "Fason"]);
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
