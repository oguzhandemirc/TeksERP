// BEKÇİ — tedarikçi seçici saf katmanı (v3, rol modeli): Yön × Fason → bacak/süzgeç · sayfa token geçişleri · satır eşlemesi
// Süzgeç çifti Cariler şeridiyle AYNI (`lib/partnerRoles`); tek eksenli "Rol" menüsü (fason bir türmüş gibi) KALKTI (16:43).
// Negatif sonda (kırmızı görüldü): `legsFor` fason bacağını `unlinkedSubcontractorLegWanted` yerine hep `true` sorunca
// "Yapmayan'da fason bacağı yok" ❌; Fason süzgeci cari bacağına inmeyince "Fason yapan → isSubcontractorRole=true" ❌.
import { describe, it, expect } from "vitest";
import { PICKER_ROLE_DEFAULTS, UNLINKED_SUBCONTRACTOR_FILTER, customerRow, firstPageToken, legsFor, nextPageToken, subcontractorRow, type PickerPage, type PickerRoleFilter } from "./supplierPicker";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { partnerRoleLabels, pickerDirectionOptions } from "@/lib/partnerRoles";

const page = (token: PickerPage["token"], next: PickerPage["next"] = null, error = false): PickerPage => ({ token, rows: [], next, error });
const cari = (o: Partial<Customer>): Customer => ({ id: "c", code: "K", name: "X", isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: false, ...o }) as Customer;
const f = (direction: PickerRoleFilter["direction"], subcontractor: PickerRoleFilter["subcontractor"] = "ALL"): PickerRoleFilter => ({ direction, subcontractor });

describe("supplierPicker (saf) — tedarikçi kipi, Yön × Fason", () => {
  it("⭐ Yön: Tümü = `isSupplierRole=true` + bağsız fason bacağı · Tedarikçi = yalnız tedarikçi (bacak yok) · Müşteri + Tedarikçi = ikisi (bacak yok)", () => {
    expect(legsFor(PICKER_ROLE_DEFAULTS)).toEqual({ customers: true, subs: true, customerFilters: { isSupplierRole: "true" } });
    expect(legsFor(f("SUPPLIER"))).toEqual({ customers: true, subs: false, customerFilters: { isSupplierRole: "true", isCustomerRole: "false" } });
    expect(legsFor(f("BOTH"))).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true", isSupplierRole: "true" } });
    expect(firstPageToken(PICKER_ROLE_DEFAULTS)).toEqual({ leg: "customers", cursor: null });
    expect(pickerDirectionOptions("supplier").map((o) => o.label)).toEqual(["Tümü", "Tedarikçi", "Müşteri + Tedarikçi"]);
  });

  it("⭐ Fason: Fason yapan → cari bacağı `isSubcontractorRole=true` + bağsız bacak (Yön Tümü); Yapmayan → `false`, bağsız bacak YOK", () => {
    expect(legsFor(f("ALL", "YES"))).toEqual({ customers: true, subs: true, customerFilters: { isSupplierRole: "true", isSubcontractorRole: "true" } });
    expect(legsFor(f("ALL", "NO"))).toEqual({ customers: true, subs: false, customerFilters: { isSupplierRole: "true", isSubcontractorRole: "false" } });
    // Yön seçiliyken bağsız bacak hiç sorulmaz (bağsız profilin kartı yok, yön uygulanamaz)
    expect(legsFor(f("SUPPLIER", "YES")).subs).toBe(false);
    expect(legsFor(f("SUPPLIER", "YES")).customerFilters).toEqual({ isSupplierRole: "true", isCustomerRole: "false", isSubcontractorRole: "true" });
  });

  it("⭐ tedarikçi kipi MÜŞTERİ-ONLY kartı HİÇBİR yoldan sormaz: 'Müşteri' seçenek değil; gelirse Tümü gibi; `type` süzgeci yok", () => {
    expect(pickerDirectionOptions("supplier").some((o) => o.value === "CUSTOMER")).toBe(false);
    expect(legsFor(f("CUSTOMER"))).toEqual(legsFor(PICKER_ROLE_DEFAULTS));
    for (const d of ["ALL", "CUSTOMER", "SUPPLIER", "BOTH"] as const) {
      const cf = legsFor(f(d)).customerFilters;
      expect(cf.isSupplierRole).toBe("true");
      expect(cf).not.toHaveProperty("type");
    }
  });

  it("⭐ token geçişi: aynı bacakta devam → Tümü'de cariler bitince fason 1 → fason bitince yok; yön seçiliyken bacak geçişi YOK", () => {
    expect(nextPageToken(page({ leg: "customers", cursor: null }, { leg: "customers", cursor: "c2" }), PICKER_ROLE_DEFAULTS)).toEqual({ leg: "customers", cursor: "c2" });
    expect(nextPageToken(page({ leg: "customers", cursor: "c2" }), PICKER_ROLE_DEFAULTS)).toEqual({ leg: "subs", page: 1 });
    expect(nextPageToken(page({ leg: "subs", page: 1 }, { leg: "subs", page: 2 }), PICKER_ROLE_DEFAULTS)).toEqual({ leg: "subs", page: 2 });
    expect(nextPageToken(page({ leg: "subs", page: 2 }), PICKER_ROLE_DEFAULTS)).toBeUndefined();
    expect(nextPageToken(page({ leg: "customers", cursor: null }), f("SUPPLIER"))).toBeUndefined();
    expect(nextPageToken(page({ leg: "customers", cursor: null }), f("ALL", "NO"))).toBeUndefined();
    // hatalı sayfa da geçer: cari bacağı 500 verdiyse Tümü'de fason yine istenir
    expect(nextPageToken(page({ leg: "customers", cursor: null }, null, true), PICKER_ROLE_DEFAULTS)).toEqual({ leg: "subs", page: 1 });
  });

  it("⭐ fason bacağı süzgeci `filter[customerId]=null` — bağlı fason ikinci kez listelenmez", () => {
    expect(UNLINKED_SUBCONTRACTOR_FILTER).toEqual({ customerId: "null" });
  });
});

describe("supplierPicker (saf) — satır eşlemesi (rol modeli)", () => {
  it("⭐ cari satırının rol etiketi BAYRAKLARDAN; fason rolü olan cari → bağlı fason tek satır, seçim CUSTOMER", () => {
    const r = customerRow(cari({ isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true, city: "Bursa", contactPhone: "0212" }));
    expect(r.roleLabel).toBe("Müşteri · Tedarikçi · Fason");
    expect(r.hasSubcontractorProfile).toBe(true);
    expect(r.kind).toBe("CUSTOMER");
    expect(customerRow(cari({ isSupplierRole: true })).roleLabel).toBe("Tedarikçi");
  });
  it("fason firması satırı düz 'Fason'; şehir null; pasif", () => {
    const s = subcontractorRow({ id: "s1", code: "FAS1", name: "Boyahane", taxNumber: null, phone: "0532", isActive: false } as Subcontractor);
    expect(s).toMatchObject({ key: "SUBCONTRACTOR:s1", kind: "SUBCONTRACTOR", roleLabel: partnerRoleLabels.subcontractor, city: null, isActive: false });
  });
});

describe("supplierPicker — müşteri kipi ve özel listeler", () => {
  it("⭐ müşteri kipi: tek cari bacağı, taban `isCustomerRole=true`; Müşteri = yalnız müşteri; BOTH = ikisi; Fason süzgeci iner; fason bacağı YOK", () => {
    expect(legsFor(PICKER_ROLE_DEFAULTS, "customer")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true" } });
    expect(legsFor(f("CUSTOMER"), "customer").customerFilters).toEqual({ isCustomerRole: "true", isSupplierRole: "false" });
    expect(legsFor(f("BOTH", "YES"), "customer").customerFilters).toEqual({ isCustomerRole: "true", isSupplierRole: "true", isSubcontractorRole: "true" });
    expect(legsFor(f("SUPPLIER"), "customer")).toEqual(legsFor(PICKER_ROLE_DEFAULTS, "customer")); // kipin dışı → Tümü
    expect(nextPageToken(page({ leg: "customers", cursor: null }), PICKER_ROLE_DEFAULTS, "customer")).toBeUndefined();
    expect(pickerDirectionOptions("customer").map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Müşteri + Tedarikçi"]);
  });
  it("dönüştürme görünümü (`customer-only`): yalnız müşteri rolü, tedarikçi rolü YOK; süzgeç uygulanmaz; fason yok", () => {
    expect(legsFor(f("BOTH", "YES"), "customer-only")).toEqual({ customers: true, subs: false, customerFilters: { isCustomerRole: "true", isSupplierRole: "false" } });
  });
  it("yalnız-cari liste (`supplier-cari`): tedarikçi tabanı, Fason süzgeci iner, bağsız fason bacağı ASLA", () => {
    expect(legsFor(PICKER_ROLE_DEFAULTS, "supplier-cari")).toEqual({ customers: true, subs: false, customerFilters: { isSupplierRole: "true" } });
    expect(legsFor(f("ALL", "YES"), "supplier-cari")).toEqual({ customers: true, subs: false, customerFilters: { isSupplierRole: "true", isSubcontractorRole: "true" } });
  });
});
