// =============================================================================
// DOKUMA RAPOR SÜZGEÇLERİ — eksen seçicisinin SAF yarısı
// =============================================================================
// ⚠️ SEÇENEK LİSTESİ SÜZGEÇSİZ YANITTAN KURULUR. Süzgeç aktifken sunucu yalnız
// seçili makinenin satırlarını döndürür; liste o yanıttan kurulsaydı TEK ÖĞEYE
// daralır ve kullanıcı başka makineye GEÇEMEZDİ (kendi seçimine kilitlenirdi).
// Bu yüzden sayfa iki sorgu tutar: pencere sorgusu (süzgeçsiz — seçenekler ve
// süzgeç yokken tablo) + süzgeçli sorgu (yalnız süzgeç aktifken). Seçenekler
// HER ZAMAN birincisinden gelir.
//
// ⚠️ NEDEN SUNUCUDAN MAKİNE LİSTESİ ÇEKİLMİYOR: `/api/stations/machines`
// `station:read` ister; raporu açan kişide `report:production` var ama o izin
// OLMAYABİLİR — seçici tam da raporun kitlesinde boş/403 olurdu. Aynı gerekçe
// yaşlandırma ekranında da yazılı (`AgingFilterBar` başlığı: "Cari SEÇİCİ yok,
// cari ARAMA var"). Pencereden türetilen liste hem izin istemez hem DÜRÜSTTÜR:
// yalnız o pencerede satırı olan makineye süzülebilir — süzülse boş dönecek bir
// makineyi seçtirmek, kullanıcıya olmayan bir veri vaat etmektir.
// =============================================================================

export interface FilterOption {
  id: string;
  label: string;
}

/** `TÜMÜ` seçimi URL'de ve istekte YOKTUR — bugünkü davranış (süzgeçsiz) budur. */
export const ALL_OPTION = "";

function uniqueSorted(items: FilterOption[]): FilterOption[] {
  const map = new Map<string, string>();
  for (const it of items) if (it.id && !map.has(it.id)) map.set(it.id, it.label);
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

export function machineOptionsFrom(
  rows: ReadonlyArray<{ machineId: string; machine: { code: string; name: string } }> | undefined,
): FilterOption[] {
  return uniqueSorted((rows ?? []).map((r) => ({ id: r.machineId, label: `${r.machine.code} · ${r.machine.name}` })));
}

export function shiftOptionsFrom(
  rows: ReadonlyArray<{ shift: { code: string; name: string }; shiftDefinitionId?: string }> | undefined,
): FilterOption[] {
  return uniqueSorted(
    (rows ?? [])
      .filter((r) => Boolean(r.shiftDefinitionId))
      .map((r) => ({ id: r.shiftDefinitionId!, label: `${r.shift.code} · ${r.shift.name}` })),
  );
}

/** Seçilen id'nin etiketi — çıktı başlığına ve süzgeç satırına girer (K10). */
export function optionLabel(options: FilterOption[], id: string): string | null {
  if (!id) return null;
  return options.find((o) => o.id === id)?.label ?? id;
}

/**
 * Tabloya hangi yanıt gider: süzgeç aktifse süzgeçli, değilse pencere yanıtı.
 * Seçenek listesi bu karardan BAĞIMSIZDIR (her zaman pencere yanıtından) — kapı
 * `dokumaFilters.test.ts` "seçim listeyi daraltmaz".
 */
export function pickReportData<T>(opts: { windowData: T | undefined; filteredData: T | undefined; filterId: string }): T | undefined {
  return opts.filterId ? opts.filteredData : opts.windowData;
}
