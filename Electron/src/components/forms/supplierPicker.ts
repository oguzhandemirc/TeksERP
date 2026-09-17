// =============================================================================
// TEDARİKÇİ SEÇİCİ MODALI — saf katman (v3): rol → bacak/süzgeç, sayfa token'ı, satır
// =============================================================================
// İki kaynak (cari kartlar `Customer` + fason firmalar `Subcontractor`) TEK sonsuz sorguyla okunur;
// sayfa token'ı bacağı ayırt eder: cari bacağı cursor'lu, fason bacağı sayfa numaralı (uç yalnız
// offset verir). "Tümü"de önce cariler tükenir, sonra fason sayfaları. Rol ve arama SUNUCUDA.
// ROL MODELİ (2026-09-17): cari bacağı ROL BAYRAKLARIYLA süzülür (`filter[isSupplierRole]=true` …), `type`
// okunmaz/yazılmaz; "rol seçimi → süzgeç" sorusunun tek kaynağı `lib/partnerRoles.ts` (`pickerCustomerFilters`).
// Tedarikçi kipi MÜŞTERİ-ONLY kartı listelemez (kullanıcı 03:25); ilk alış için dönüştürme görünümü
// (`customer-only`): kart seçilir, Tedarikçi ROLÜ eklenir, tedarikçi olarak seçilir.
// =============================================================================
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SupplierParty, SupplierPartyKind } from "./supplierParty";
import { partnerRoleLabels, partnerRoleText, pickerCustomerFilters, type DirectionFilter, type RoleServerFilters } from "@/lib/partnerRoles";

export const SUPPLIER_PICKER_PAGE = 50;

/** Seçici kipi: tedarikçi (alış: tedarikçi rolü olan cari + fason) · müşteri (satış: müşteri rolü olan cari). */
export type PickerMode = "supplier" | "customer";
/** Listelenen küme: kip · dönüştürme görünümü (yalnız müşteri rolü, tedarikçi rolü YOK; fason yok) · yalnız cari
 *  tedarikçiler (`supplier-cari`: fason bacağı yok — fason profilinin "Bağlı cari" alanı). */
export type PickerList = PickerMode | "customer-only" | "supplier-cari";

/** Seçici rol kutusunun değeri — yön ya da fason bacağı. */
export type SupplierRoleFilter = DirectionFilter | "SUBCONTRACTOR";

type RoleOption = { value: SupplierRoleFilter; label: string };
const BOTH_LABEL = `${partnerRoleLabels.customer} + ${partnerRoleLabels.supplier}`;
/** Tedarikçi kipinde rol: Tümü · Tedarikçi · Müşteri + Tedarikçi · Fason — "Müşteri" seçeneği YOK (kural üstte). */
export const SUPPLIER_ROLE_FILTER_OPTIONS: readonly RoleOption[] = [
  { value: "ALL", label: "Tümü" },
  { value: "SUPPLIER", label: partnerRoleLabels.supplier },
  { value: "BOTH", label: BOTH_LABEL },
  { value: "SUBCONTRACTOR", label: partnerRoleLabels.subcontractor },
];
/** Müşteri kipinde rol: Tümü · Müşteri · Müşteri + Tedarikçi (tedarikçi-only ve fason satışta anlamsız). */
export const CUSTOMER_ROLE_FILTER_OPTIONS: readonly RoleOption[] = [
  { value: "ALL", label: "Tümü" },
  { value: "CUSTOMER", label: partnerRoleLabels.customer },
  { value: "BOTH", label: BOTH_LABEL },
];
/** Yalnız cari tedarikçiler (fason profilinin "Bağlı cari" alanı): Fason seçeneği yok. */
export const SUPPLIER_CARI_ROLE_FILTER_OPTIONS: readonly RoleOption[] = SUPPLIER_ROLE_FILTER_OPTIONS.filter((o) => o.value !== "SUBCONTRACTOR");
export const roleFilterOptions = (list: PickerList) =>
  list === "customer" || list === "customer-only" ? CUSTOMER_ROLE_FILTER_OPTIONS : list === "supplier-cari" ? SUPPLIER_CARI_ROLE_FILTER_OPTIONS : SUPPLIER_ROLE_FILTER_OPTIONS;
/** Süzgeç tetiği kapalıyken de ADINI taşır: "Rol: Tümü" / "Rol: Tedarikçi" (kullanıcı 03:27; açılır listede "Tümü" kalır). */
export const roleTriggerText = (list: PickerList, role: SupplierRoleFilter) => `Rol: ${roleFilterOptions(list).find((o) => o.value === role)?.label ?? "Tümü"}`;

/** Sayfa token'ı — bacağı ve o bacaktaki konumu taşır; cari bacağı tek sorgudur (süzgeç `legsFor`tan). */
export type PageToken = { leg: "customers"; cursor: string | null } | { leg: "subs"; page: number };

export interface PickerLegs {
  customers: boolean;
  subs: boolean;
  /** Cari bacağının `filter[...]` çiftleri (rol bayrakları). */
  customerFilters: RoleServerFilters;
}

/** Listenin sorduğu bacaklar + cari süzgeci. Tedarikçi kipinde müşteri-only kart HİÇBİR yoldan gelmez:
 *  "Müşteri" rolü seçenek değildir; yine de gelirse "Tümü" gibi davranır (fail-closed). */
export function legsFor(role: SupplierRoleFilter, list: PickerList = "supplier"): PickerLegs {
  if (list === "customer-only") return { customers: true, subs: false, customerFilters: pickerCustomerFilters("customer", "CUSTOMER") };
  if (list === "customer") {
    const r: DirectionFilter = role === "CUSTOMER" || role === "BOTH" ? role : "ALL";
    return { customers: true, subs: false, customerFilters: pickerCustomerFilters("customer", r) };
  }
  if (role === "SUBCONTRACTOR" && list === "supplier") return { customers: false, subs: true, customerFilters: {} };
  // "Müşteri" tedarikçi kipinde seçenek değil — gelirse Tümü (fail-closed: müşteri-only asla, fason bacağı Tümü gibi).
  const r: DirectionFilter = role === "SUPPLIER" || role === "BOTH" ? role : "ALL";
  return { customers: true, subs: list === "supplier" && r === "ALL", customerFilters: pickerCustomerFilters("supplier", r) };
}

export function firstPageToken(role: SupplierRoleFilter, list: PickerList = "supplier"): PageToken {
  const l = legsFor(role, list);
  if (!l.customers) return { leg: "subs", page: 1 };
  return { leg: "customers", cursor: null };
}

/** Bir sayfanın sonucu — bacaktan bağımsız normalize (hata da bir sayfadır: öbür bacak listelenmeye devam eder). */
export interface PickerPage {
  token: PageToken;
  rows: SupplierPickerRow[];
  /** Cari: sonraki cursor; fason: `page < totalPages`. */
  next: PageToken | null;
  error: boolean;
}

/** Sonraki token: aynı bacakta devam; cari bacağı bitince fason 1. sayfa (tedarikçi kipi ALL); hepsi bitince yok. */
export function nextPageToken(page: PickerPage, role: SupplierRoleFilter, list: PickerList = "supplier"): PageToken | undefined {
  if (page.next) return page.next;
  if (page.token.leg !== "customers") return undefined;
  return legsFor(role, list).subs ? { leg: "subs", page: 1 } : undefined;
}

export interface SupplierPickerRow extends SupplierParty {
  key: string;
  code: string | null;
  name: string;
  /** Rol etiketi — cari: bayraklardan ("Müşteri · Tedarikçi · Fason"); fason firması: "Fason". */
  roleLabel: string;
  /** Cari satırı AKTİF fason profili taşıyor → seçim yine `kind:"CUSTOMER"` (bağlı fason tek satır). */
  hasSubcontractorProfile: boolean;
  taxNumber: string | null;
  phone: string | null;
  /** Yalnız cari kartta (müşteri kipi "Şehir" kolonu); fasonda null. */
  city: string | null;
  isActive: boolean;
}

type RowSource = { id: string; code?: string | null; name: string; taxNumber?: string | null; isActive?: boolean };
function row(kind: SupplierPartyKind, r: RowSource, extra: { roleLabel: string; phone: string | null; city: string | null; hasSubcontractorProfile: boolean }): SupplierPickerRow {
  return { kind, id: r.id, key: `${kind}:${r.id}`, code: r.code ?? null, name: r.name, taxNumber: r.taxNumber ?? null, isActive: r.isActive !== false, ...extra };
}
export const customerRow = (c: Customer): SupplierPickerRow =>
  row("CUSTOMER", c, { roleLabel: partnerRoleText(c), phone: c.contactPhone ?? null, city: c.city ?? null, hasSubcontractorProfile: c.isSubcontractorRole === true });
export const subcontractorRow = (s: Subcontractor): SupplierPickerRow => row("SUBCONTRACTOR", s, { roleLabel: partnerRoleLabels.subcontractor, phone: s.phone ?? null, city: null, hasSubcontractorProfile: false });
/** Fason bacağının süzgeci: bağlı fason cari satırında görünür (fason rolü rozetiyle), bacak yalnız BAĞSIZ fasonları getirir. */
export const UNLINKED_SUBCONTRACTOR_FILTER = { customerId: "null" } as const;
