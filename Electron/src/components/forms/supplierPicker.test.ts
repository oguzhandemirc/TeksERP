// BEKÇİ — tedarikçi seçici saf katmanı (v3, rol modeli): rol → bacak/süzgeç · sayfa token geçişleri · satır eşlemesi
import { describe, it, expect } from "vitest";
import { CUSTOMER_ROLE_FILTER_OPTIONS, SUPPLIER_ROLE_FILTER_OPTIONS, UNLINKED_SUBCONTRACTOR_FILTER, customerRow, firstPageToken, legsFor, nextPageToken, roleFilterOptions, roleTriggerText, subcontractorRow, type PickerPage } from "./supplierPicker";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { partnerRoleLabels } from "@/lib/partnerRoles";

const page = (token: PickerPage["token"], next: PickerPage["next"] = null, error = false): PickerPage => ({ token, rows: [], next, error });
const cari = (o: Partial<Customer>): Customer => ({ id: "c", code: "K", name: "X", isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: false, ...o }) as Customer;

describe("supplierPicker (saf) — tedarikçi kipi", () => {
  it("⭐ rol → bacak: ALL = cari bacağı `isSupplierRole=true` + fason · Fason yalnız fason · Tedarikçi = yalnız tedarikçi · BOTH = ikisi", () => {
    expect(legsFor("ALL")).toEqual({ customers: true, subs: true, customerFilters: { isSupplierRole: "true" } });
    expect(legsFor("SUBCONTRACTOR")).toEqual({ customers: false, subs: true, customerFilters: {} });
    expect(legsFor("SUPPLIER")).toEqual({ customers: true, subs: false, customerFilters: { isSupplierRole: "true", isCustomerRole: "false" } });
    expect(legsFor("BOTH")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true", isSupplierRole: "true" } });
    expect(firstPageToken("ALL")).toEqual({ leg: "customers", cursor: null });
    expect(firstPageToken("SUBCONTRACTOR")).toEqual({ leg: "subs", page: 1 });
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Tedarikçi", "Müşteri + Tedarikçi", "Fason"]);
  });

  it("⭐ tedarikçi kipi MÜŞTERİ-ONLY kartı HİÇBİR yoldan sormaz: seçeneklerde yok; rol olarak gelirse 'Tümü' gibi; `type` süzgeci hiç yok", () => {
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.some((o) => o.value === "CUSTOMER")).toBe(false);
    expect(legsFor("CUSTOMER")).toEqual(legsFor("ALL"));
    for (const role of ["ALL", "CUSTOMER", "SUPPLIER", "BOTH"] as const) {
      const f = legsFor(role).customerFilters;
      expect(f.isSupplierRole).toBe("true");
      expect(f).not.toHaveProperty("type");
    }
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

  it("⭐ fason bacağı süzgeci `filter[customerId]=null` — bağlı fason ikinci kez listelenmez", () => {
    expect(UNLINKED_SUBCONTRACTOR_FILTER).toEqual({ customerId: "null" });
  });
});

describe("supplierPicker (saf) — satır eşlemesi (rol modeli)", () => {
  it("⭐ cari satırının rol etiketi BAYRAKLARDAN ('Müşteri · Tedarikçi · Fason'); fason rolü olan cari → bağlı fason tek satır, seçim CUSTOMER", () => {
    const r = customerRow(cari({ isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true, city: "Bursa", contactPhone: "0212" }));
    expect(r.roleLabel).toBe("Müşteri · Tedarikçi · Fason");
    expect(r.hasSubcontractorProfile).toBe(true);
    expect(r.kind).toBe("CUSTOMER");
    expect(r.city).toBe("Bursa");
    expect(customerRow(cari({ isSupplierRole: true })).roleLabel).toBe("Tedarikçi");
    expect(customerRow(cari({ isSupplierRole: true })).hasSubcontractorProfile).toBe(false);
  });
  it("fason firması satırı düz 'Fason'; şehir null; pasif", () => {
    const s = subcontractorRow({ id: "s1", code: "FAS1", name: "Boyahane", taxNumber: null, phone: "0532", isActive: false } as Subcontractor);
    expect(s).toMatchObject({ key: "SUBCONTRACTOR:s1", kind: "SUBCONTRACTOR", roleLabel: partnerRoleLabels.subcontractor, phone: "0532", taxNumber: null, city: null, isActive: false });
  });
});

describe("supplierPicker — müşteri kipi", () => {
  it("⭐ tek cari bacağı: ALL = müşteri rolü olan hepsi (eski CUSTOMER→BOTH iki bacak KALKTI); Müşteri = yalnız müşteri; BOTH = ikisi; fason yok", () => {
    expect(legsFor("ALL", "customer")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true" } });
    expect(legsFor("CUSTOMER", "customer")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true", isSupplierRole: "false" } });
    expect(legsFor("BOTH", "customer")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true", isSupplierRole: "true" } });
    expect(nextPageToken(page({ leg: "customers", cursor: null }), "ALL", "customer")).toBeUndefined();
    expect(CUSTOMER_ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Müşteri + Tedarikçi"]);
  });
  it("dönüştürme görünümü (`customer-only`): yalnız müşteri rolü, tedarikçi rolü YOK; fason yok; bacak geçişi yok", () => {
    expect(legsFor("ALL", "customer-only")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true", isSupplierRole: "false" } });
    expect(nextPageToken(page({ leg: "customers", cursor: null }), "ALL", "customer-only")).toBeUndefined();
  });
  it("yalnız-cari liste (`supplier-cari`): fason bacağı yok, ALL = tedarikçi rolü, rol seçeneklerinde Fason yok", () => {
    expect(legsFor("ALL", "supplier-cari")).toEqual({ customers: true, subs: false, customerFilters: { isSupplierRole: "true" } });
    expect(legsFor("BOTH", "supplier-cari")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true", isSupplierRole: "true" } });
    expect(legsFor("SUBCONTRACTOR", "supplier-cari")).toEqual({ customers: true, subs: false, customerFilters: { isSupplierRole: "true" } });
    expect(roleFilterOptions("supplier-cari").map((o) => o.label)).toEqual(["Tümü", "Tedarikçi", "Müşteri + Tedarikçi"]);
    expect(roleTriggerText("supplier-cari", "ALL")).toBe("Rol: Tümü");
    expect(roleTriggerText("supplier", "SUPPLIER")).toBe("Rol: Tedarikçi");
  });
});
