import { describe, it, expect } from "vitest";
import { SUPPLIER_ROLE_FILTER_OPTIONS, supplierRoleQuery, toSupplierPickerRows } from "./supplierPicker";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";

const cust = (o: Partial<Customer>): Customer => ({ id: "c", code: "C", name: "Cari", type: "SUPPLIER", taxNumber: null, contactPhone: null, isActive: true, ...o }) as Customer;
const sub = (o: Partial<Subcontractor>): Subcontractor => ({ id: "s", code: "S", name: "Fasoncu", taxNumber: null, phone: null, isActive: true, ...o }) as Subcontractor;

describe("Tedarikçi liste modalı — saf katman (rev.)", () => {
  it("⭐ rol seçimi SUNUCU parametresine çevrilir: Tümü iki bacak filtresiz · Fason yalnız fason · cari rolleri filter[type]", () => {
    expect(supplierRoleQuery("ALL")).toEqual({ customers: true, subcontractors: true });
    expect(supplierRoleQuery("SUBCONTRACTOR")).toEqual({ customers: false, subcontractors: true });
    expect(supplierRoleQuery("SUPPLIER")).toEqual({ customers: true, subcontractors: false, customerType: "SUPPLIER" });
    expect(supplierRoleQuery("CUSTOMER")).toEqual({ customers: true, subcontractors: false, customerType: "CUSTOMER" });
    expect(SUPPLIER_ROLE_FILTER_OPTIONS.map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Tedarikçi", "Alıcı + Satıcı", "Fason"]);
  });

  it("⭐ TAM liste: müşteri-only kart da satırdır (Rol 'Müşteri'); sıra sunucunun (cariler önce, fason sonra); telefon/vergi no taşınır", () => {
    const rows = toSupplierPickerRows(
      [cust({ id: "c1", name: "Zeta", type: "SUPPLIER", taxNumber: "111", contactPhone: "0212" }), cust({ id: "c3", name: "Müşteri", type: "CUSTOMER" })],
      [sub({ id: "s1", name: "Alfa Fason", phone: "0532", taxNumber: "222" })],
    );
    expect(rows.map((r) => `${r.key}:${r.role}`)).toEqual(["CUSTOMER:c1:SUPPLIER", "CUSTOMER:c3:CUSTOMER", "SUBCONTRACTOR:s1:SUBCONTRACTOR"]);
    expect(rows[0]).toMatchObject({ taxNumber: "111", phone: "0212" });
    expect(rows[2]).toMatchObject({ taxNumber: "222", phone: "0532", kind: "SUBCONTRACTOR" });
  });
});
