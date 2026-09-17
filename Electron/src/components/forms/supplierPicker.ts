// =============================================================================
// TEDARİKÇİ SEÇİCİ MODALI — saf katman (v3, sıfırdan): rol → bacak/parametre, sayfa token'ı, satır
// =============================================================================
// İki kaynak (cari kartlar `Customer` + fason firmalar `Subcontractor`) TEK sonsuz sorguyla okunur;
// sayfa token'ı bacağı ayırt eder: cari bacağı cursor'lu, fason bacağı sayfa numaralı (uç yalnız
// offset verir). "Tümü"de önce cariler tükenir, sonra fason sayfaları. Rol ve arama SUNUCUDA.
// Kullanıcı kararı (2026-09-17 03:25): tedarikçi kipi MÜŞTERİ-ONLY (type=CUSTOMER) kartı LİSTELEMEZ —
// "müşteriden alış yapıyorsak o kart artık Müşteri + Tedarikçi'dir". İlk alış için ayrı görünüm
// (`customer-only`): kart seçilir, tipi BOTH'a çevrilir, sonra tedarikçi olarak seçilir.
// =============================================================================
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SupplierParty, SupplierPartyKind } from "./supplierParty";
import { companyTypeLabels, type CompanyType } from "@/types/enums";

export const SUPPLIER_PICKER_PAGE = 50;

/** Seçici kipi: tedarikçi (alış: SUPPLIER/BOTH cari + fason) · müşteri (satış: yalnız cari, CUSTOMER sonra BOTH). */
export type PickerMode = "supplier" | "customer";
/** Listelenen küme: kip ya da dönüştürme görünümü (yalnız type=CUSTOMER kartlar; fason yok). */
export type PickerList = PickerMode | "customer-only";

export type SupplierRole = CompanyType | "SUBCONTRACTOR";
export type SupplierRoleFilter = "ALL" | SupplierRole;
/** Tedarikçi kipinde "Tümü"nün cari bacağı: yalnız tedarikçi + her ikisi (müşteri-only DIŞARIDA). */
export const SUPPLIER_ALL_CUSTOMER_TYPES = "SUPPLIER,BOTH" as const;
/** Cari bacağının `filter[type]`i — tek tip ya da CSV; uç CSV'yi `in`e çevirir (`buildWhereClause`). */
export type CustomerTypeParam = CompanyType | typeof SUPPLIER_ALL_CUSTOMER_TYPES;

/** Rol etiketi — cari tipleri `companyTypeLabels`tan (tek kaynak), fason yalnız burada. */
export const SUPPLIER_ROLE_LABEL: Record<SupplierRole, string> = {
  ...companyTypeLabels,
  SUBCONTRACTOR: "Fason",
};
type RoleOption = { value: SupplierRoleFilter; label: string };
/** Tedarikçi kipinde rol: Tümü · Tedarikçi · Müşteri + Tedarikçi · Fason — "Müşteri" seçeneği YOK (kural üstte). */
export const SUPPLIER_ROLE_FILTER_OPTIONS: readonly RoleOption[] = [
  { value: "ALL", label: "Tümü" },
  { value: "SUPPLIER", label: SUPPLIER_ROLE_LABEL.SUPPLIER },
  { value: "BOTH", label: SUPPLIER_ROLE_LABEL.BOTH },
  { value: "SUBCONTRACTOR", label: SUPPLIER_ROLE_LABEL.SUBCONTRACTOR },
];
/** Müşteri kipinde rol: Tümü · Müşteri · Müşteri + Tedarikçi (tedarikçi-only ve fason satışta anlamsız). */
export const CUSTOMER_ROLE_FILTER_OPTIONS: readonly RoleOption[] = [
  { value: "ALL", label: "Tümü" },
  { value: "CUSTOMER", label: SUPPLIER_ROLE_LABEL.CUSTOMER },
  { value: "BOTH", label: SUPPLIER_ROLE_LABEL.BOTH },
];
export const roleFilterOptions = (mode: PickerMode) => (mode === "customer" ? CUSTOMER_ROLE_FILTER_OPTIONS : SUPPLIER_ROLE_FILTER_OPTIONS);
/** Süzgeç tetiği kapalıyken de ADINI taşır: "Rol: Tümü" / "Rol: Tedarikçi" (kullanıcı 03:27; açılır listede "Tümü" kalır). */
export const roleTriggerText = (mode: PickerMode, role: SupplierRoleFilter) => `Rol: ${roleFilterOptions(mode).find((o) => o.value === role)?.label ?? "Tümü"}`;

/** Sayfa token'ı — bacağı ve o bacaktaki konumu taşır; cari bacağında `type` = o bacağın `filter[type]`i
 *  (müşteri kipinde "Tümü" = CUSTOMER bacağı bitince BOTH bacağı; tedarikçi kipinde "Tümü" = tek CSV bacağı). */
export type PageToken = { leg: "customers"; cursor: string | null; type?: CustomerTypeParam } | { leg: "subs"; page: number };

export interface PickerLegs {
  customers: boolean;
  subs: boolean;
  customerType?: CustomerTypeParam;
  customerTypes?: CustomerTypeParam[];
}

/** Listenin sorduğu bacaklar; cari bacağına giden `filter[type]`. Tedarikçi kipinde CUSTOMER tipi HİÇBİR
 *  yoldan sorulmaz — "Müşteri" rolü seçenek değildir; yine de gelirse "Tümü" gibi davranır (fail-closed). */
export function legsFor(role: SupplierRoleFilter, list: PickerList = "supplier"): PickerLegs {
  if (list === "customer-only") return { customers: true, subs: false, customerType: "CUSTOMER" };
  if (list === "customer") {
    if (role === "ALL") return { customers: true, subs: false, customerTypes: ["CUSTOMER", "BOTH"] };
    return { customers: true, subs: false, customerType: role === "BOTH" ? "BOTH" : "CUSTOMER" };
  }
  if (role === "SUBCONTRACTOR") return { customers: false, subs: true };
  if (role === "SUPPLIER" || role === "BOTH") return { customers: true, subs: false, customerType: role };
  return { customers: true, subs: true, customerType: SUPPLIER_ALL_CUSTOMER_TYPES };
}

export function firstPageToken(role: SupplierRoleFilter, list: PickerList = "supplier"): PageToken {
  const l = legsFor(role, list);
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
export function nextPageToken(page: PickerPage, role: SupplierRoleFilter, list: PickerList = "supplier"): PageToken | undefined {
  if (page.next) return page.next;
  if (page.token.leg !== "customers") return undefined;
  const l = legsFor(role, list);
  if (l.customerTypes) {
    const i = l.customerTypes.indexOf(page.token.type as CustomerTypeParam);
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
