// =============================================================================
// İŞ ORTAĞI ROLLERİ — saf katman: etiket · rozet · "rol seçimi → sunucu süzgeci" (TEK KAYNAK, 2026-09-17)
// =============================================================================
// Kart tek, roller üç bayrak (`isCustomerRole` · `isSupplierRole` · `isSubcontractorRole`); `type` türetilmiş
// ve panelde YAZILMAZ. Cariler şeridi (Yön × Fason) ile tedarikçi/müşteri seçicisi AYNI soruyu sorar:
// "bu rol seçimi hangi sunucu süzgecidir?" — cevap yalnız burada (9b notu: iki kopya ayrışıyordu).
// Süzgeçler skaler kolon (`filter[isSupplierRole]=true`) ya da `filter[role]` (tekil OR); sunucu süzer.
// =============================================================================

export interface PartnerRoleFlags {
  isCustomerRole: boolean;
  isSupplierRole: boolean;
  isSubcontractorRole: boolean;
}

/** Bayrak etiketleri — her yüzeyin tek kaynağı (eski tip-etiketi sözlüğü silindi; `Customer.type` panelde okunmaz). */
export const partnerRoleLabels = { customer: "Müşteri", supplier: "Tedarikçi", subcontractor: "Fason" } as const;
export type PartnerRoleKey = keyof typeof partnerRoleLabels;

/** Kartın rozetleri — bayrak başına, sabit sırada (Müşteri · Tedarikçi · Fason). */
export function partnerRoleBadges(flags: Partial<PartnerRoleFlags> | null | undefined): string[] {
  const out: string[] = [];
  if (flags?.isCustomerRole) out.push(partnerRoleLabels.customer);
  if (flags?.isSupplierRole) out.push(partnerRoleLabels.supplier);
  if (flags?.isSubcontractorRole) out.push(partnerRoleLabels.subcontractor);
  return out;
}

/** Tek satır etiket: "Müşteri · Tedarikçi · Fason"; rolsüz kart (olmamalı) "—". */
export const partnerRoleText = (flags: Partial<PartnerRoleFlags> | null | undefined): string => partnerRoleBadges(flags).join(" · ") || "—";

/** Ticari YÖN seçimi (Cariler şeridi + seçici rol kutusu). */
export type DirectionFilter = "ALL" | "CUSTOMER" | "SUPPLIER" | "BOTH";
/** Fason seçimi (Cariler şeridi). */
export type SubcontractorFilter = "ALL" | "YES" | "NO";

export const DIRECTION_OPTIONS: readonly { value: DirectionFilter; label: string }[] = [
  { value: "ALL", label: "Tümü" },
  { value: "CUSTOMER", label: partnerRoleLabels.customer },
  { value: "SUPPLIER", label: partnerRoleLabels.supplier },
  { value: "BOTH", label: `${partnerRoleLabels.customer} + ${partnerRoleLabels.supplier}` },
];
export const SUBCONTRACTOR_OPTIONS: readonly { value: SubcontractorFilter; label: string }[] = [
  { value: "ALL", label: "Tümü" },
  { value: "YES", label: "Fason yapan" },
  { value: "NO", label: "Yapmayan" },
];

/** Sunucu süzgeci — `filter[...]` anahtar/değer çiftleri (değerler string: CSV de string'dir). */
export type RoleServerFilters = Readonly<Record<string, string>>;

/**
 * Yön seçimi → cari süzgeci. Müşteri = müşteri rolü olan (yalnız ya da ikisi), Tedarikçi = tedarikçi rolü
 * olan; "Müşteri + Tedarikçi" = İKİ bayrağı da taşıyan (skaler AND — `filter[role]` OR verdiği için burada
 * kullanılmaz); Tümü = süzgeç yok.
 */
export function directionFilters(direction: DirectionFilter): RoleServerFilters {
  switch (direction) {
    case "CUSTOMER":
      return { role: "customer" };
    case "SUPPLIER":
      return { role: "supplier" };
    case "BOTH":
      return { isCustomerRole: "true", isSupplierRole: "true" };
    default:
      return {};
  }
}

/** Fason seçimi → cari süzgeci (bayrak skaler). */
export function subcontractorFilters(f: SubcontractorFilter): RoleServerFilters {
  if (f === "YES") return { isSubcontractorRole: "true" };
  if (f === "NO") return { isSubcontractorRole: "false" };
  return {};
}

/**
 * SEÇİCİ bacakları — "yalnız o rol" anlamı (seçici satırın rol rozeti kalır, süzgeç kesin):
 *   tedarikçi kipi: Tümü = tedarikçi rolü olan hepsi · Tedarikçi = yalnız tedarikçi (müşteri rolü yok) ·
 *   Müşteri + Tedarikçi = ikisi; müşteri kipi: Tümü = müşteri rolü olan hepsi · Müşteri = yalnız müşteri ·
 *   Müşteri + Tedarikçi = ikisi. Fason kartı burada değil: fason bacağı ayrı sorgudur (bağsız profiller).
 */
export function pickerCustomerFilters(mode: "supplier" | "customer", role: DirectionFilter): RoleServerFilters {
  const own = mode === "supplier" ? "isSupplierRole" : "isCustomerRole";
  const other = mode === "supplier" ? "isCustomerRole" : "isSupplierRole";
  if (role === "BOTH") return { isCustomerRole: "true", isSupplierRole: "true" };
  if ((mode === "supplier" && role === "SUPPLIER") || (mode === "customer" && role === "CUSTOMER")) return { [own]: "true", [other]: "false" };
  return { [own]: "true" };
}

/** Yön × Fason seçimi — Cariler şeridi ve seçiciler AYNI çifti taşır (tek yüklem, kopya yok). */
export interface RoleFilterPair {
  direction: DirectionFilter;
  subcontractor: SubcontractorFilter;
}
export const ROLE_FILTER_DEFAULTS: RoleFilterPair = { direction: "ALL", subcontractor: "ALL" };
export const isRoleFilterDirty = (f: RoleFilterPair): boolean => f.direction !== "ALL" || f.subcontractor !== "ALL";

/**
 * BAĞSIZ fason bacağı (`filter[customerId]=null`) ne zaman sorulur: yalnız Yön = Tümü ve Fason ≠ Yapmayan.
 * Bağsız profilin kartı yok — yön süzgeci ona uygulanamaz; göç (D2) sonrası 0 satır, bacak eski kurulum güvencesi.
 */
export const unlinkedSubcontractorLegWanted = (f: RoleFilterPair): boolean => f.direction === "ALL" && f.subcontractor !== "NO";

/** Seçicinin YÖN seçenekleri — kipin kendi rolü olmayan seçenek çizilmez (tedarikçi kipinde "Müşteri" yok);
 *  cari kipi (muhasebe formları: her rol) Cariler şeridinin tam listesini taşır. */
export const pickerDirectionOptions = (mode: "supplier" | "customer" | "cari"): readonly { value: DirectionFilter; label: string }[] =>
  mode === "cari" ? DIRECTION_OPTIONS : DIRECTION_OPTIONS.filter((o) => o.value !== (mode === "supplier" ? "CUSTOMER" : "SUPPLIER"));
