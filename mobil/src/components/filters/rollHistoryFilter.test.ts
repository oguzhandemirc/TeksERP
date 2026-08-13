// =============================================================================
// Bekçi: rollHistoryFilter — KK1 + Tambur ORTAK filtresinin saf katmanı
// =============================================================================
// Kilitlenen sözleşmeler:
//   • filtre YOKSA hiçbir parametre üretilmez (mevcut istek bayt bayt korunur),
//   • tarih gönderilirken `dateField` DE gönderilir — yoksa backend aralığı
//     SESSİZCE yok sayar ve "filtre seçili ama liste süzülmüyor" doğar,
//   • `last7` BUGÜNÜ içerir,
//   • özel aralık kısa yolu EZER (iki aralık aynı anda iddia edilmez),
//   • query anahtarı `itemLabel`den ve `now`dan BAĞIMSIZDIR.
// =============================================================================

import {
  EMPTY_ROLL_FILTER,
  buildRollQueryParams,
  effectiveRange,
  filterQueryKey,
  forcedCreatorFilter,
  formatRange,
  hasActiveFilter,
  resolveQuickRange,
  type RollHistoryFilterState,
} from './rollHistoryFilter';

/** 12 Ağustos 2026, 14:30 yerel. */
const NOW = new Date(2026, 7, 12, 14, 30, 0, 0);

describe('resolveQuickRange', () => {
  it('"Tümü" → aralık YOK', () => {
    expect(resolveQuickRange('all', NOW)).toBeNull();
  });

  it('"Bugün" → yerel gün başı ile gün sonu', () => {
    const r = resolveQuickRange('today', NOW)!;
    expect(r.from.getHours()).toBe(0);
    expect(r.from.getDate()).toBe(12);
    expect(r.to.getHours()).toBe(23);
    expect(r.to.getMilliseconds()).toBe(999);
    expect(r.to.getDate()).toBe(12);
  });

  it('"Dün" → yalnız önceki gün', () => {
    const r = resolveQuickRange('yesterday', NOW)!;
    expect(r.from.getDate()).toBe(11);
    expect(r.to.getDate()).toBe(11);
  });

  it('⭐ "Son 7 gün" BUGÜNÜ İÇERİR (6 gün geri + bugün)', () => {
    // Bugünü dışlamak, bugün girilen topu listeden düşürür ve filtre "bozuk"
    // görünür — vardiyadaki kişinin kastettiği aralık bu değil.
    const r = resolveQuickRange('last7', NOW)!;
    expect(r.from.getDate()).toBe(6);
    expect(r.to.getDate()).toBe(12);
  });

  it('ay sınırını doğru aşar', () => {
    const r = resolveQuickRange('last7', new Date(2026, 7, 3, 9, 0))!;
    expect(r.from.getMonth()).toBe(6); // Temmuz
    expect(r.from.getDate()).toBe(28);
  });
});

describe('buildRollQueryParams', () => {
  it('⭐ filtre YOKSA hiçbir parametre üretilmez (mevcut istek korunur)', () => {
    const p = buildRollQueryParams(EMPTY_ROLL_FILTER, NOW);
    expect(p.filters).toEqual({});
    expect(p.dateField).toBeUndefined();
    expect(p.dateFrom).toBeUndefined();
    expect(p.dateTo).toBeUndefined();
  });

  it('⭐ tarih varsa `dateField` DE gider (yoksa backend sessizce yok sayar)', () => {
    // applyDateRange: `if (!params.dateField || !allowed.includes(...)) return`
    const p = buildRollQueryParams({ ...EMPTY_ROLL_FILTER, quick: 'today' }, NOW);
    expect(p.dateField).toBe('createdAt');
    expect(p.dateFrom).toBeTruthy();
    expect(p.dateTo).toBeTruthy();
  });

  it('kumaş seçilince `filter[itemId]` üretilir', () => {
    const p = buildRollQueryParams(
      { ...EMPTY_ROLL_FILTER, itemId: 'item-1', itemLabel: 'PATOS' },
      NOW,
    );
    expect(p.filters.itemId).toBe('item-1');
  });

  it('⭐ özel aralık kısa yolu EZER', () => {
    const custom = { from: new Date(2026, 0, 1, 0, 0), to: new Date(2026, 0, 5, 23, 59, 59, 999) };
    const state: RollHistoryFilterState = { ...EMPTY_ROLL_FILTER, quick: 'today', custom };
    const p = buildRollQueryParams(state, NOW);
    expect(p.dateFrom).toBe(custom.from.toISOString());
    expect(p.dateTo).toBe(custom.to.toISOString());
  });
});

describe('filterQueryKey', () => {
  it('⭐ `itemLabel` anahtarı DEĞİŞTİRMEZ (ad düzeltmesi yeniden çekmesin)', () => {
    const a = filterQueryKey({ ...EMPTY_ROLL_FILTER, itemId: 'x', itemLabel: 'PATOS' });
    const b = filterQueryKey({ ...EMPTY_ROLL_FILTER, itemId: 'x', itemLabel: 'PATOS 2' });
    expect(a).toBe(b);
  });

  it('farklı filtreler farklı anahtar üretir', () => {
    const a = filterQueryKey({ ...EMPTY_ROLL_FILTER, quick: 'today' });
    const b = filterQueryKey({ ...EMPTY_ROLL_FILTER, quick: 'yesterday' });
    const c = filterQueryKey({ ...EMPTY_ROLL_FILTER, itemId: 'x', itemLabel: null });
    expect(new Set([a, b, c, filterQueryKey(EMPTY_ROLL_FILTER)]).size).toBe(4);
  });
});

describe('hasActiveFilter / effectiveRange / formatRange', () => {
  it('boş durumda filtre aktif değil', () => {
    expect(hasActiveFilter(EMPTY_ROLL_FILTER)).toBe(false);
  });

  it('kumaş tek başına filtreyi aktif eder', () => {
    expect(hasActiveFilter({ ...EMPTY_ROLL_FILTER, itemId: 'x', itemLabel: 'A' })).toBe(true);
  });

  it('effectiveRange özel aralığı önceler', () => {
    const custom = { from: new Date(2026, 0, 1), to: new Date(2026, 0, 1, 23, 59) };
    const r = effectiveRange({ ...EMPTY_ROLL_FILTER, quick: 'last7', custom }, NOW)!;
    expect(r).toBe(custom);
  });

  it('aynı güne düşen aralık TEK tarih basar', () => {
    const r = resolveQuickRange('today', NOW)!;
    expect(formatRange(r)).toBe('12.08.2026');
  });

  it('çok günlü aralık iki tarih basar', () => {
    const r = resolveQuickRange('last7', NOW)!;
    expect(formatRange(r)).toBe('06.08.2026 — 12.08.2026');
  });
});

// =============================================================================
// OPERATÖR + GİRİŞ İSTASYONU eksenleri ve KAPSAM kuralı (2026-08-12)
// =============================================================================

describe('operatör + giriş istasyonu filtreleri', () => {
  it('operatör seçilince filter[createdById] üretilir', () => {
    const p = buildRollQueryParams(
      { ...EMPTY_ROLL_FILTER, operatorId: 'u-1', operatorLabel: 'Ahmet' },
      NOW,
    );
    expect(p.filters.createdById).toBe('u-1');
  });

  it('giriş istasyonu seçilince filter[entryStationId] üretilir', () => {
    const p = buildRollQueryParams(
      { ...EMPTY_ROLL_FILTER, entryStationId: 'st-1', entryStationLabel: 'KK1' },
      NOW,
    );
    expect(p.filters.entryStationId).toBe('st-1');
  });

  it('yeni eksenler hasActiveFilter ve queryKey tarafından tanınır', () => {
    const op = { ...EMPTY_ROLL_FILTER, operatorId: 'u-1', operatorLabel: 'A' };
    const st = { ...EMPTY_ROLL_FILTER, entryStationId: 's-1', entryStationLabel: 'B' };
    expect(hasActiveFilter(op)).toBe(true);
    expect(hasActiveFilter(st)).toBe(true);
    expect(new Set([filterQueryKey(op), filterQueryKey(st), filterQueryKey(EMPTY_ROLL_FILTER)]).size).toBe(3);
  });

  it('etiketler queryKey\'i DEĞİŞTİRMEZ (ad düzeltmesi yeniden çekmesin)', () => {
    const a = filterQueryKey({ ...EMPTY_ROLL_FILTER, operatorId: 'u', operatorLabel: 'X' });
    const b = filterQueryKey({ ...EMPTY_ROLL_FILTER, operatorId: 'u', operatorLabel: 'Y' });
    expect(a).toBe(b);
  });
});

describe('forcedCreatorFilter — "Tüm Girişler" kapsam kuralı', () => {
  it('⭐ bayrak KAPALI + kimlik var → zorunlu createdById (yalnız kendi kayıtları)', () => {
    // Kural burada saf: ekrandaki bir if'te yaşasaydı tersine çevrilmesi hiçbir
    // testi kırmazdı. Sıra sözleşmesi: KK1 bunu filters'a EN SON yayar ki çipten
    // sızabilecek bir createdById'yi de ezsin.
    expect(forcedCreatorFilter(false, 'me-1')).toEqual({ createdById: 'me-1' });
  });

  it('bayrak AÇIK → daraltma yok (herkesin kayıtları)', () => {
    expect(forcedCreatorFilter(true, 'me-1')).toEqual({});
  });

  it('kimlik yüklenmemişse boş string GÖNDERİLMEZ (liste sessizce boşalırdı)', () => {
    expect(forcedCreatorFilter(false, null)).toEqual({});
  });
});
