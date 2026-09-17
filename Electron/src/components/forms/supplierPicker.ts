// =============================================================================
// TEDARİKÇİ SEÇİCİ MODALI — saf katman (v3): rol → bacak/süzgeç, sayfa token'ı, satır
// =============================================================================
// İki kaynak (cari kartlar `Customer` + fason firmalar `Subcontractor`) TEK sonsuz sorguyla okunur;
// sayfa token'ı bacağı ayırt eder: cari bacağı cursor'lu, fason bacağı sayfa numaralı (uç yalnız
// offset verir). "Tümü"de önce cariler tükenir, sonra fason sayfaları. Rol ve arama SUNUCUDA.
// ROL MODELİ (2026-09-17): cari bacağı ROL BAYRAKLARIYLA süzülür (`filter[isSupplierRole]=true` …), `type`
// okunmaz/yazılmaz; "rol seçimi → süzgeç" sorusunun tek kaynağı `lib/partnerRoles.ts` (`pickerCustomerFilters`).
// Tedarikçi kipi MÜŞTERİ-ONLY kartı listelemez (kullanıcı 03:25); ilk alış için dönüştürme görünümü
// (`customer-only`): kart seçilir, Tedarikçi ROLÜ eklenir, tedarikçi olarak seçilir. Süzgeç Cariler şeridiyle AYNI
// iki eksen (Yön × Fason, kullanıcı 16:43) — tek eksenli "Rol" menüsü (fason bir türmüş gibi) KALKTI.
// =============================================================================
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { SupplierParty, SupplierPartyKind } from "./supplierParty";
import { ROLE_FILTER_DEFAULTS, partnerRoleLabels, partnerRoleText, pickerCustomerFilters, subcontractorFilters, unlinkedSubcontractorLegWanted, type DirectionFilter, type RoleFilterPair, type RoleServerFilters } from "@/lib/partnerRoles";

export const SUPPLIER_PICKER_PAGE = 50;

/** Seçici kipi: tedarikçi (alış: tedarikçi rolü olan cari + fason) · müşteri (satış: müşteri rolü olan cari). */
export type PickerMode = "supplier" | "customer";
/** Listelenen küme: kip · dönüştürme görünümü (yalnız müşteri rolü, tedarikçi rolü YOK; fason yok) · yalnız cari
 *  tedarikçiler (`supplier-cari`: fason bacağı yok — fason profilinin "Bağlı cari" alanı). */
export type PickerList = PickerMode | "customer-only" | "supplier-cari";

/** Seçici süzgeci — Cariler şeridiyle AYNI çift (Yön × Fason); fason bir tür değil roldür (kullanıcı 16:43). */
export type PickerRoleFilter = RoleFilterPair;
export const PICKER_ROLE_DEFAULTS: PickerRoleFilter = ROLE_FILTER_DEFAULTS;

/** Sayfa token'ı — bacağı ve o bacaktaki konumu taşır; cari bacağı tek sorgudur (süzgeç `legsFor`tan). */
export type PageToken = { leg: "customers"; cursor: string | null } | { leg: "subs"; page: number };

export interface PickerLegs {
  customers: boolean;
  subs: boolean;
  /** Cari bacağının `filter[...]` çiftleri (rol bayrakları). */
  customerFilters: RoleServerFilters;
}

/**
 * Listenin sorduğu bacaklar + cari süzgeci. Kipin rolü tabandır (tedarikçi: `isSupplierRole=true`, müşteri:
 * `isCustomerRole=true`); Yön kipin dışındaki seçeneği tanımaz (gelirse Tümü — fail-closed: müşteri-only asla);
 * Fason süzgeci bayrağa iner. BAĞSIZ fason bacağı yalnız tedarikçi kipinde, Yön=Tümü ve Fason≠Yapmayan iken.
 */
export function legsFor(f: PickerRoleFilter, list: PickerList = "supplier"): PickerLegs {
  if (list === "customer-only") return { customers: true, subs: false, customerFilters: pickerCustomerFilters("customer", "CUSTOMER") };
  const mode: PickerMode = list === "customer" ? "customer" : "supplier";
  const own = mode === "customer" ? "CUSTOMER" : "SUPPLIER";
  const direction: DirectionFilter = f.direction === own || f.direction === "BOTH" ? f.direction : "ALL";
  const norm: PickerRoleFilter = { direction, subcontractor: f.subcontractor };
  return {
    customers: true,
    subs: list === "supplier" && unlinkedSubcontractorLegWanted(norm),
    customerFilters: { ...pickerCustomerFilters(mode, direction), ...subcontractorFilters(f.subcontractor) },
  };
}

export function firstPageToken(f: PickerRoleFilter, list: PickerList = "supplier"): PageToken {
  const l = legsFor(f, list);
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

/** Sonraki token: aynı bacakta devam; cari bacağı bitince fason 1. sayfa (tedarikçi kipi, bağsız bacak istenmişse); hepsi bitince yok. */
export function nextPageToken(page: PickerPage, f: PickerRoleFilter, list: PickerList = "supplier"): PageToken | undefined {
  if (page.next) return page.next;
  if (page.token.leg !== "customers") return undefined;
  return legsFor(f, list).subs ? { leg: "subs", page: 1 } : undefined;
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
