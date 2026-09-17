// =============================================================================
// CARİLER EKRANI — iki-kaynaklı sayfalama + İKİ SÜZGEÇ (Yön × Fason) → sorgu planı
// =============================================================================
// Rol modeli (2026-09-17): "Rol" tek seçicisi yerine iki `LabeledSelect` — Yön (Tümü · Müşteri · Tedarikçi ·
// Müşteri + Tedarikçi) ve Fason (Tümü · Fason yapan · Yapmayan). "Seçim → sunucu süzgeci" sorusu TEK kaynaktan
// (`lib/partnerRoles.ts`) — tedarikçi seçicisiyle aynı helper; kopya yasak (9b notu).
//
// ⚠️ Süzme SUNUCUDA: liste sayfalı, istemcide süzmek yalnız O ANKİ SAYFAYI süzer ve kullanıcı "Fason"
// seçtiğinde ilk sayfada fason yoksa "kayıt yok" sanır — oysa kayıt bir sonraki sayfadadır (`RollFilterBar` dersi).
// Fason bacağı (BAĞSIZ profiller — D2 göçünden sonra 0): yalnız Yön = Tümü ve Fason ≠ Yapmayan iken sorulur;
// bağlı fason CARİ satırında "Fason" rozetiyle tek kez görünür.
// =============================================================================
import { directionFilters, subcontractorFilters, type DirectionFilter, type RoleServerFilters, type SubcontractorFilter } from "@/lib/partnerRoles";

export interface CariFilters {
  direction: DirectionFilter;
  subcontractor: SubcontractorFilter;
}
export const CARI_FILTER_DEFAULTS: CariFilters = { direction: "ALL", subcontractor: "ALL" };

export interface CariQueryPlan {
  customers: boolean;
  subcontractors: boolean;
  /** Cari bacağının `filter[...]` çiftleri (rol bayrakları). */
  customerFilters: RoleServerFilters;
}

/** İki süzgeçten SORGU PLANI — cari bacağı hep süzülür; fason bacağı yalnız Yön=Tümü ve Fason≠Yapmayan. */
export function cariQueryPlan(f: CariFilters): CariQueryPlan {
  return {
    customers: true,
    subcontractors: f.direction === "ALL" && f.subcontractor !== "NO",
    customerFilters: { ...directionFilters(f.direction), ...subcontractorFilters(f.subcontractor) },
  };
}

/** Şerit "süzgeç var mı" — temizle düğmesi ve boş metin bunu okur. */
export const isCariFilterDirty = (f: CariFilters): boolean => f.direction !== "ALL" || f.subcontractor !== "ALL";

export interface CariMergeRow {
  kind: "CUSTOMER" | "SUBCONTRACTOR";
  id: string;
  name: string;
}

/**
 * İki kaynağın AYNI sayfasını birleştirip ada göre sıralar.
 *
 * ⚠️ Sıralama `localeCompare(…, "tr")`: "Ç" ile "C", "İ" ile "I" ASCII sırada
 * yanlış yere düşer ve kullanıcı listeyi alfabetik saymaz.
 */
export function mergeCariRows<T extends CariMergeRow>(customers: T[], subs: T[]): T[] {
  return [...customers, ...subs].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/**
 * Sayfa bilgisi — iki kaynağın toplamı.
 *
 * ⚠️ `hasNext` İKİSİNİN "VEYA"sıdır: biri bitip diğeri devam ediyorsa sayfa
 * hâlâ vardır. "VE" yazılsaydı, müşterileri biten kurulumda fason kartlarının
 * kuyruğu sessizce erişilemez olurdu.
 */
export function cariPageInfo(args: {
  page: number;
  pageSize: number;
  customerTotal: number;
  subTotal: number;
  plan: { customers: boolean; subcontractors: boolean };
}): { total: number; hasPrev: boolean; hasNext: boolean } {
  const cTotal = args.plan.customers ? args.customerTotal : 0;
  const sTotal = args.plan.subcontractors ? args.subTotal : 0;
  const consumed = args.page * args.pageSize;
  return {
    total: cTotal + sTotal,
    hasPrev: args.page > 1,
    hasNext: (args.plan.customers && cTotal > consumed) || (args.plan.subcontractors && sTotal > consumed),
  };
}
