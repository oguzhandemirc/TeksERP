// =============================================================================
// rollHistoryFilter — top listesi filtrelerinin SAF katmanı
// =============================================================================
// KK1 "Tüm Girişler" ve Tambur "Son Çıkan Toplar" modalları AYNI filtreleri
// paylaşır (zaman + kumaş). Karar mantığı burada, ekranlardan bağımsız durur:
// bir `useState` yığınının içinde yaşasaydı iki ekran kaçınılmaz olarak
// birbirinden ayrışır ve "aynı düğme iki listede farklı aralık" doğardı.
//
// ⚠️ FİLTRE BACKEND'E GİDER, İSTEMCİDE SÜZÜLMEZ (ürün kararı). Liste zaten
// cursor'lu sonsuz kaydırma: istemcide süzmek yalnız O ANKİ SAYFAYI süzer ve
// operatör "kayıt yok" sanır — oysa kayıt bir sonraki sayfadadır. Sunucu
// tarafı hazır: `filter[itemId]` + `dateField=createdAt&dateFrom&dateTo`
// (`inventory.buildRollWhere` → `applyDateRange`, ROLL_DATE_FIELDS).
//
// ⚠️ GÜN SINIRI CİHAZIN YEREL GÜNÜDÜR. Tabletler fabrikada (Europe/Istanbul)
// ve backend `dateFrom`/`dateTo`yu MUTLAK AN olarak alır — yani istemcinin
// niyetini iki kez yorumlamaz (Electron `useReportDateRange` ile aynı sözleşme).
// =============================================================================

/** Tek dokunuşluk aralıklar. `all` = tarih filtresi YOK. */
export type QuickRangeKind = 'all' | 'today' | 'yesterday' | 'last7';

export interface DateRange {
  /** Gün başlangıcı (yerel 00:00:00.000). */
  from: Date;
  /** Gün sonu (yerel 23:59:59.999) — `lte` ile kullanılır. */
  to: Date;
}

export interface RollHistoryFilterState {
  quick: QuickRangeKind;
  /** `quick === 'custom'` yok: özel aralık seçilince quick 'all'a düşer ve
   *  bu alan dolar. Tek kaynak olsun diye iki alan aynı anda AKTİF OLAMAZ. */
  custom: DateRange | null;
  itemId: string | null;
  /** Yalnız çip etiketi için — sunucuya gitmez. */
  itemLabel: string | null;
  /** Operatör (Roll.createdById) — 2026-08-12: "hangi personel girdi". */
  operatorId: string | null;
  operatorLabel: string | null;
  /** Giriş istasyonu (Roll.entryStationId) — topun sisteme GİRDİĞİ yer. */
  entryStationId: string | null;
  entryStationLabel: string | null;
}

export const EMPTY_ROLL_FILTER: RollHistoryFilterState = {
  quick: 'all',
  custom: null,
  itemId: null,
  itemLabel: null,
  operatorId: null,
  operatorLabel: null,
  entryStationId: null,
  entryStationLabel: null,
};

export const QUICK_LABELS: Record<QuickRangeKind, string> = {
  all: 'Tümü',
  today: 'Bugün',
  yesterday: 'Dün',
  last7: 'Son 7 gün',
};

/** Yerel gün başı (00:00:00.000). */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Yerel gün sonu (23:59:59.999) — aralık `lte` ile kapandığı için son ms dahil. */
export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Kısa yolun karşılığı olan aralık. `all` → null (tarih filtresi yok).
 *
 * ⚠️ `last7` BUGÜNÜ İÇERİR (bugün dahil 7 gün, yani -6 gün). Vardiyadaki
 * kişinin "son 7 gün" derken kastettiği budur; bugünü dışlamak bugün girilen
 * topu listeden düşürür ve filtre "bozuk" görünür.
 */
export function resolveQuickRange(kind: QuickRangeKind, now: Date): DateRange | null {
  switch (kind) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const y = addDays(now, -1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'last7':
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now) };
    case 'all':
    default:
      return null;
  }
}

/** Ekranda gösterilen aralık — özel seçim kısa yolu EZER. */
export function effectiveRange(state: RollHistoryFilterState, now: Date): DateRange | null {
  if (state.custom) return state.custom;
  return resolveQuickRange(state.quick, now);
}

export interface RollQueryFilterParams {
  filters: Record<string, string>;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Sorgu parametreleri. Filtre YOKSA hiçbir anahtar üretilmez — böylece
 * filtresiz istek bugünküyle BAYT BAYT aynı kalır (mevcut davranış korunur).
 *
 * ⚠️ `dateField` GÖNDERİLMEK ZORUNDA: backend `applyDateRange` alan adı yoksa
 * aralığı SESSİZCE yok sayar (`if (!params.dateField) return`) — yani tarih
 * seçili görünür ama liste süzülmezdi.
 */
export function buildRollQueryParams(
  state: RollHistoryFilterState,
  now: Date,
): RollQueryFilterParams {
  const out: RollQueryFilterParams = { filters: {} };
  if (state.itemId) out.filters.itemId = state.itemId;
  if (state.operatorId) out.filters.createdById = state.operatorId;
  if (state.entryStationId) out.filters.entryStationId = state.entryStationId;
  const range = effectiveRange(state, now);
  if (range) {
    out.dateField = 'createdAt';
    out.dateFrom = range.from.toISOString();
    out.dateTo = range.to.toISOString();
  }
  return out;
}

/**
 * "Tüm Girişler" kapsam kuralı (2026-08-12): bayrak KAPALIYKEN liste operatörün
 * kendi kayıtlarına ZORUNLU daraltılır — dönen filtre sorgunun filters'ına EN SON
 * yayılır ki çipten sızabilecek bir createdById'yi de ezsin.
 *
 * Saf fonksiyon: ekrandaki bir `if`te yaşasaydı tersine çevrilmesi hiçbir testi
 * kırmazdı (`shouldReleaseInFlight` emsali). Kullanıcı kimliği henüz yüklenmemişse
 * (yalnız açılış yarışında olur) filtre üretilmez — boş string createdById
 * göndermek listeyi sessizce boşaltırdı; kimliksiz pencere milisaniyelerdir.
 */
export function forcedCreatorFilter(
  allEntriesEnabled: boolean,
  authUserId: string | null,
): Record<string, string> {
  if (allEntriesEnabled) return {};
  if (!authUserId) return {};
  return { createdById: authUserId };
}

/** Herhangi bir filtre aktif mi (şeritte "Temizle" bunun için çıkar). */
export function hasActiveFilter(state: RollHistoryFilterState): boolean {
  return (
    state.quick !== 'all' ||
    state.custom !== null ||
    state.itemId !== null ||
    state.operatorId !== null ||
    state.entryStationId !== null
  );
}

/**
 * react-query anahtarına giren KARARLI parça.
 *
 * ⚠️ `itemLabel` DIŞARIDA — o yalnız çip metnidir. Anahtara girseydi aynı
 * kumaşın adı düzeltildiğinde (master-data düzenlemesi) aynı sorgu ikinci kez
 * ağdan çekilirdi. Aynı gerekçeyle `now` da girmez: her render'da değişir ve
 * liste sonsuz yeniden çekilirdi — gün sınırı sorgu ANINDA çözülür.
 */
export function filterQueryKey(state: RollHistoryFilterState): string {
  const parts = [
    state.custom
      ? `c:${state.custom.from.toISOString()}..${state.custom.to.toISOString()}`
      : `q:${state.quick}`,
    state.itemId ? `i:${state.itemId}` : 'i:-',
    state.operatorId ? `o:${state.operatorId}` : 'o:-',
    state.entryStationId ? `s:${state.entryStationId}` : 's:-',
  ];
  return parts.join('|');
}

/** "12.08.2026" — çip ve başlık metinleri için. */
export function formatDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Aralığın operatöre görünen özeti. Aynı güne düşen aralık TEK tarih basar. */
export function formatRange(range: DateRange): string {
  const a = formatDay(range.from);
  const b = formatDay(range.to);
  return a === b ? a : `${a} — ${b}`;
}
