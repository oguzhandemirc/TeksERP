// =============================================================================
// TEDARİKÇİ SEÇİCİ MODALI — saf katman (v3, sıfırdan): rol → bacak/parametre, sayfa token'ı, satır
// =============================================================================
// İki kaynak (cari kartlar `Customer` + fason firmalar `Subcontractor`) TEK sonsuz sorguyla okunur;
// sayfa token'ı bacağı ayırt eder: cari bacağı cursor'lu, fason bacağı sayfa numaralı (uç yalnız
// offset verir). "Tümü"de önce cariler tükenir, sonra fason sayfaları. Rol ve arama SUNUCUDA.
// =============================================================================
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SupplierParty, SupplierPartyKind } from "./supplierParty";

export const SUPPLIER_PICKER_PAGE = 50;

export type SupplierRole = "CUSTOMER" | "SUPPLIER" | "BOTH" | "SUBCONTRACTOR";
export type SupplierRoleFilter = "ALL" | SupplierRole;

export const SUPPLIER_ROLE_LABEL: Record<SupplierRole, string> = {
  CUSTOMER: "Müşteri",
  SUPPLIER: "Tedarikçi",
  BOTH: "Alıcı + Satıcı",
  SUBCONTRACTOR: "Fason",
};
export const SUPPLIER_ROLE_FILTER_OPTIONS: readonly { value: SupplierRoleFilter; label: string }[] = [
  { value: "ALL", label: "Tümü" },
  { value: "CUSTOMER", label: SUPPLIER_ROLE_LABEL.CUSTOMER },
  { value: "SUPPLIER", label: SUPPLIER_ROLE_LABEL.SUPPLIER },
  { value: "BOTH", label: SUPPLIER_ROLE_LABEL.BOTH },
  { value: "SUBCONTRACTOR", label: SUPPLIER_ROLE_LABEL.SUBCONTRACTOR },
];

/** Sayfa token'ı — bacağı ve o bacaktaki konumu taşır. */
export type PageToken = { leg: "customers"; cursor: string | null } | { leg: "subs"; page: number };

/** Rolün sorduğu bacaklar; cari bacağına giden `filter[type]` (ALL'da yok). */
export function legsFor(role: SupplierRoleFilter): { customers: boolean; subs: boolean; customerType?: SupplierRole } {
  if (role === "ALL") return { customers: true, subs: true };
  if (role === "SUBCONTRACTOR") return { customers: false, subs: true };
  return { customers: true, subs: false, customerType: role };
}

export function firstPageToken(role: SupplierRoleFilter): PageToken {
  return legsFor(role).customers ? { leg: "customers", cursor: null } : { leg: "subs", page: 1 };
}

/** Bir sayfanın sonucu — bacaktan bağımsız normalize (hata da bir sayfadır: öbür bacak listelenmeye devam eder). */
export interface PickerPage {
  token: PageToken;
  rows: SupplierPickerRow[];
  /** Cari: sonraki cursor; fason: `page < totalPages`. */
  next: PageToken | null;
  error: boolean;
}

/** Sonraki token: aynı bacakta devam; cari bitince (ALL) fason 1. sayfa; fason bitince yok. */
export function nextPageToken(page: PickerPage, role: SupplierRoleFilter): PageToken | undefined {
  if (page.next) return page.next;
  if (page.token.leg === "customers" && legsFor(role).subs) return { leg: "subs", page: 1 };
  return undefined;
}

export interface SupplierPickerRow extends SupplierParty {
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
export const customerRow = (c: Customer): SupplierPickerRow => row("CUSTOMER", c, c.type, c.contactPhone ?? null);
export const subcontractorRow = (s: Subcontractor): SupplierPickerRow => row("SUBCONTRACTOR", s, "SUBCONTRACTOR", s.phone ?? null);
