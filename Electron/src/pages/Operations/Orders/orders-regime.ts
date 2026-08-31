// =============================================================================
// SİPARİŞLER — TİCARET REJİMİ SÜZGECİ (saf katman)
// =============================================================================
// Alım-satım firmasında sipariş → SEVK zinciri iş emrine hiç bakmıyor (persona
// denetiminde ölçüldü). Buna rağmen ekran üç yerde üretim kavramı basıyordu:
// "İş Emri" rollup kolonu (her satırda "İş emri yok"), "İş Emri" filtresi
// (tanım gereği hep tek sonuç) ve seçim çubuğundaki "İş Emri Aç" toplu aksiyonu
// (o kullanıcının hiç kullanmayacağı, üstelik yanlışlıkla basınca üretim
// dünyasına kapı açan bir düğme).
//
// ⚠️ FABRİKADA HİÇBİRİ DEĞİŞMEZ. Bekçi: `orders-regime.test.ts`.
// =============================================================================
import type { FilterDef } from "@/components/data-table/FilterBar";

/** Üretim kavramına bakan filtre anahtarları — rejimde şeritten düşerler. */
const PRODUCTION_FILTER_KEYS = ["woState"];

/**
 * Filtre şeridi — rejime göre.
 *
 * ⚠️ Anahtar (`woState`) silinmez, yalnız ŞERİTTEN düşer: backend süzgeci
 * (`OrderService.extraWhere`) ve rollup semantiği yerinde kalır; kayıtlı bir
 * URL o filtreyi hâlâ taşıyabilir ve doğru çalışır.
 */
export function resolveOrderFilters(all: FilterDef[], productionEnabled: boolean): FilterDef[] {
  if (productionEnabled) return all;
  return all.filter((f) => !("key" in f) || !PRODUCTION_FILTER_KEYS.includes(f.key as string));
}

/**
 * Seçim çubuğunda "İş Emri Aç" görünür mü?
 *
 * ⚠️ İZİN KONTROLÜ DEĞİL — o ayrı bir katman (`workorder:write`). Bu yalnız
 * rejim: izinli bir kullanıcı bile ticaret kurulumunda bu düğmeyi görmemeli,
 * çünkü orada üretim akışının kendisi kullanılmıyor.
 */
export function canBulkCreateWorkOrder(productionEnabled: boolean): boolean {
  return productionEnabled;
}
