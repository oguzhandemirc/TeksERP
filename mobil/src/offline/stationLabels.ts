// =============================================================================
// stationLabels — istasyon kaydının operatöre GÖRÜNEN adı
// =============================================================================
// `mutations.ts`ten AYRI dosyada duruyor çünkü `mutations.ts` → `queryClient.ts`
// import ediyor; etiketler orada kalsaydı `queryClient` → `mutations` bağı bir
// İÇE AKTARMA DÖNGÜSÜ olurdu (kalıcı düşüş toast'ı etiketi burada okuyor).
// `mutations.ts` ikisini de re-export eder, yani mevcut çağrı yerleri değişmez.
// =============================================================================

/**
 * ⚠️ YENİ `STATION_MUT` ANAHTARI EKLERKEN BURAYA DA SATIR EKLE — bekçi
 * (`mutations.test.ts`) etiketi olmayan anahtarı geliştirme anında düşürür.
 * Aksi hâlde operatör hata toast'ında ham anahtarı ("kk1-create-entry") görür.
 */
export const STATION_MUT_LABELS: Record<string, string> = {
  'qc2-complete': 'Kurşun / QC2',
  'qc2-report-error': 'QC2 hata bildirimi',
  'qc2-delete-error': 'QC2 hata silme',
  'qc2-finish-step': 'QC2 adım kapatma',
  'kursun-finish': 'Kurşun bitirme',
  'tambur-finalize-open-fabric': 'Tambur finalize',
  'kk1-create-entry': 'Ham Giriş',
  'kk1-scrap': 'Top iptali',
  'fason-kabul-receive': 'Fason Kabul',
  'fason-sevk-dispatch': 'Fason Sevk',
  'kartela-sevk-dispatch': 'Kartela Sevk',
  'kartela-kabul-receive': 'Kartela Kabul',
};

/** Bilinmeyen anahtar boş basmaz, ham anahtarı gösterir (sessiz kayıp yok). */
export function stationOpLabel(key: unknown): string {
  if (!Array.isArray(key) || typeof key[1] !== 'string') return 'İşlem';
  return STATION_MUT_LABELS[key[1]] ?? key[1];
}
