import { describe, it, expect } from "vitest";
import { filterSupplierRows, toSupplierPickerRows, SUPPLIER_ROLE_LABEL } from "./supplierPicker";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";

const cust = (o: Partial<Customer>): Customer => ({ id: "c", code: "C", name: "Cari", type: "SUPPLIER", taxNumber: null, contactPhone: null, isActive: true, ...o }) as Customer;
const sub = (o: Partial<Subcontractor>): Subcontractor => ({ id: "s", code: "S", name: "Fasoncu", taxNumber: null, phone: null, isActive: true, ...o }) as Subcontractor;

describe("Tedarikçi liste modalı — saf katman", () => {
  it("⭐ iki bacak tek liste; müşteri-only kart ATILIR; ad sırası; rol/telefon/vergi no taşınır", () => {
    const rows = toSupplierPickerRows(
      [cust({ id: "c1", name: "Zeta", type: "SUPPLIER", taxNumber: "111", contactPhone: "0212" }), cust({ id: "c2", name: "Alfa", type: "BOTH" }), cust({ id: "c3", name: "Müşteri", type: "CUSTOMER" })],
      [sub({ id: "s1", name: "Beta", phone: "0532", taxNumber: "222" })],
    );
    expect(rows.map((r) => `${r.key}:${r.role}`)).toEqual(["CUSTOMER:c2:BOTH", "SUBCONTRACTOR:s1:SUBCONTRACTOR", "CUSTOMER:c1:SUPPLIER"]);
    expect(rows[2]).toMatchObject({ taxNumber: "111", phone: "0212" });
    expect(rows[1]).toMatchObject({ taxNumber: "222", phone: "0532", kind: "SUBCONTRACTOR" });
    expect(SUPPLIER_ROLE_LABEL.SUBCONTRACTOR).toBe("Fason");
  });

  it("⭐ rol süzgeci: yalnız Fason → fason satırı; boş küme → boş liste (sessizce hepsi olmaz)", () => {
    const rows = toSupplierPickerRows([cust({ id: "c1", type: "SUPPLIER" }), cust({ id: "c2", type: "BOTH" })], [sub({ id: "s1" })]);
    expect(filterSupplierRows(rows, new Set(["SUBCONTRACTOR"])).map((r) => r.key)).toEqual(["SUBCONTRACTOR:s1"]);
    expect(filterSupplierRows(rows, new Set(["SUPPLIER", "BOTH"]))).toHaveLength(2);
    expect(filterSupplierRows(rows, new Set())).toHaveLength(0);
  });
});
