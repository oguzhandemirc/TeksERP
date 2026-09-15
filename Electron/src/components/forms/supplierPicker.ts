// =============================================================================
// TEDARİKÇİ LİSTE MODALI — saf katman: iki bacak → tek tablo satırı, rol süzgeci (kullanıcı isteği #5)
// =============================================================================
// Alış siparişinde küçük açılır kutu yetmedi: kullanıcı FİLTRELENEBİLİR bir liste istedi (rol · arama ·
// Kod · Ünvan · Rol · Vergi No · Telefon). Satır iki tablodan gelir (`Customer` + `Subcontractor`); rol
// üç seçenek: Tedarikçi (Customer.type SUPPLIER) · Alıcı + Satıcı (BOTH) · Fason (Subcontractor). Yalnız
// müşteri (CUSTOMER) kartlar alışta anlamsız — BİLEREK listelenmez (küçük kutu onları da çizmeye devam eder;
// bugünkü davranış orada bayt bayt).
// =============================================================================
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SupplierParty, SupplierPartyKind } from "./supplierParty";

export type SupplierRole = "SUPPLIER" | "BOTH" | "SUBCONTRACTOR";

export const SUPPLIER_ROLE_LABEL: Record<SupplierRole, string> = {
  SUPPLIER: "Tedarikçi",
  BOTH: "Alıcı + Satıcı",
  SUBCONTRACTOR: "Fason",
};
export const SUPPLIER_ROLES: readonly SupplierRole[] = ["SUPPLIER", "BOTH", "SUBCONTRACTOR"];

export interface SupplierPickerRow extends SupplierParty {
  /** `kind:id` — tablo satır anahtarı (iki tabloda aynı id çakışmasın). */
  key: string;
  code: string | null;
  name: string;
  role: SupplierRole;
  taxNumber: string | null;
  phone: string | null;
  isActive: boolean;
}

function row(kind: SupplierPartyKind, r: { id: string; code?: string | null; name: string; taxNumber?: string | null; isActive?: boolean }, role: SupplierRole, phone: string | null): SupplierPickerRow {
  return { kind, id: r.id, key: `${kind}:${r.id}`, code: r.code ?? null, name: r.name, role, taxNumber: r.taxNumber ?? null, phone, isActive: r.isActive !== false };
}

/** İki bacağı tek listeye açar; müşteri-only kartı ATAR; ad sırası (tr). */
export function toSupplierPickerRows(customers: readonly Customer[] | undefined, subcontractors: readonly Subcontractor[] | undefined): SupplierPickerRow[] {
  const out: SupplierPickerRow[] = [];
  for (const c of customers ?? []) {
    if (c.type === "SUPPLIER" || c.type === "BOTH") out.push(row("CUSTOMER", c, c.type, c.contactPhone ?? null));
  }
  for (const s of subcontractors ?? []) out.push(row("SUBCONTRACTOR", s, "SUBCONTRACTOR", s.phone ?? null));
  return out.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Rol süzgeci — boş küme "hepsi" DEĞİL, hiçbiri (kullanıcı bütün çipleri kapattıysa liste boşalır, sessizce dolmaz). */
export function filterSupplierRows(rows: readonly SupplierPickerRow[], roles: ReadonlySet<SupplierRole>): SupplierPickerRow[] {
  return rows.filter((r) => roles.has(r.role));
}
