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

/** Seçici kipi: tedarikçi (alış: cari + fason) · müşteri (satış: yalnız cari, CUSTOMER sonra BOTH). */
export type PickerMode = "supplier" | "customer";

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
/** Müşteri kipinde rol: Tümü · Müşteri · Alıcı + Satıcı (tedarikçi-only ve fason satışta anlamsız). */
export const CUSTOMER_ROLE_FILTER_OPTIONS: readonly { value: SupplierRoleFilter; label: string }[] = SUPPLIER_ROLE_FILTER_OPTIONS.filter((o) => o.value === "ALL" || o.value === "CUSTOMER" || o.value === "BOTH");
export const roleFilterOptions = (mode: PickerMode) => (mode === "customer" ? CUSTOMER_ROLE_FILTER_OPTIONS : SUPPLIER_ROLE_FILTER_OPTIONS);

/** Sayfa token'ı — bacağı ve o bacaktaki konumu taşır; cari bacağında `type` = o bacağın `filter[type]`i
 *  (müşteri kipinde "Tümü" = CUSTOMER bacağı bitince BOTH bacağı — uç tek `filter[type]` alır). */
export type PageToken = { leg: "customers"; cursor: string | null; type?: SupplierRole } | { leg: "subs"; page: number };

/** Rolün sorduğu bacaklar; cari bacağına giden `filter[type]` (tedarikçi kipinde ALL'da yok). */
export function legsFor(role: SupplierRoleFilter, mode: PickerMode = "supplier"): { customers: boolean; subs: boolean; customerType?: SupplierRole; customerTypes?: SupplierRole[] } {
  if (mode === "customer") {
    if (role === "ALL") return { customers: true, subs: false, customerTypes: ["CUSTOMER", "BOTH"] };
    return { customers: true, subs: false, customerType: role === "BOTH" ? "BOTH" : "CUSTOMER" };
  }
  if (role === "ALL") return { customers: true, subs: true };
  if (role === "SUBCONTRACTOR") return { customers: false, subs: true };
  return { customers: true, subs: false, customerType: role };
}

export function firstPageToken(role: SupplierRoleFilter, mode: PickerMode = "supplier"): PageToken {
  const l = legsFor(role, mode);
  if (!l.customers) return { leg: "subs", page: 1 };
  const type = l.customerTypes?.[0] ?? l.customerType;
  return { leg: "customers", cursor: null, ...(type ? { type } : {}) };
}

/** Bir sayfanın sonucu — bacaktan bağımsız normalize (hata da bir sayfadır: öbür bacak listelenmeye devam eder). */
export interface PickerPage {
  token: PageToken;
  rows: SupplierPickerRow[];
  /** Cari: sonraki cursor; fason: `page < totalPages`. */
  next: PageToken | null;
  error: boolean;
}

/** Sonraki token: aynı bacakta devam; cari bacağı bitince sıradaki cari tipi (müşteri kipi ALL: CUSTOMER → BOTH)
 *  ya da fason 1. sayfa (tedarikçi kipi ALL); hepsi bitince yok. */
export function nextPageToken(page: PickerPage, role: SupplierRoleFilter, mode: PickerMode = "supplier"): PageToken | undefined {
  if (page.next) return page.next;
  if (page.token.leg !== "customers") return undefined;
  const l = legsFor(role, mode);
  if (l.customerTypes) {
    const i = l.customerTypes.indexOf(page.token.type as SupplierRole);
    const nextType = l.customerTypes[i + 1];
    if (nextType) return { leg: "customers", cursor: null, type: nextType };
  }
  if (l.subs) return { leg: "subs", page: 1 };
  return undefined;
}

export interface SupplierPickerRow extends SupplierParty {
  key: string;
  code: string | null;
  name: string;
  role: SupplierRole;
  taxNumber: string | null;
  phone: string | null;
  /** Yalnız cari kartta (müşteri kipi "Şehir" kolonu); fasonda null. */
  city: string | null;
  isActive: boolean;
}

type RowSource = { id: string; code?: string | null; name: string; taxNumber?: string | null; isActive?: boolean };
function row(kind: SupplierPartyKind, r: RowSource, extra: { role: SupplierRole; phone: string | null; city: string | null }): SupplierPickerRow {
  return { kind, id: r.id, key: `${kind}:${r.id}`, code: r.code ?? null, name: r.name, taxNumber: r.taxNumber ?? null, isActive: r.isActive !== false, ...extra };
}
export const customerRow = (c: Customer): SupplierPickerRow => row("CUSTOMER", c, { role: c.type, phone: c.contactPhone ?? null, city: c.city ?? null });
export const subcontractorRow = (s: Subcontractor): SupplierPickerRow => row("SUBCONTRACTOR", s, { role: "SUBCONTRACTOR", phone: s.phone ?? null, city: null });
