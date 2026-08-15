// =============================================================================
// ReferenceSelect — PASİF SEÇİM SINIFI (saf katman)
// =============================================================================
// Bekçi: `referenceSelectState.test.ts`.
//
// SORUN: liste sorgusu her çağrıda `filter[isActive]=true` gönderir, seçili
// kaydın etiketi ise `getById` ile çözülür ve o uç pasif kaydı OLDUĞU GİBİ
// döner (`base.service.findById`). Sonuç: tedarikçisi sonradan pasife alınmış
// bir alış siparişini açıp alakasız bir alanı düzelten kullanıcı, ad normal
// görünürken "Kaydet"te `"X" pasif durumda.` hatası alır ve hatanın HANGİ
// ALANDAN geldiği ekranda hiçbir yerde yazmaz.
//
// ⚠️ YÜKLEM "listede yok" DEĞİL, "kaydın kendisi pasif": liste sayfalıdır (50)
// ve aramayla süzülür → alfabetik 51. sıradaki AKTİF kayıt da "listede yok"tur.
// O ölçüte bakan bir rozet, günlük kullanımda sürekli yanlış "pasif" basar ve
// üç günde görünmez olur. `isActive === false` kesin bilgidir; alanı hiç
// taşımayan modelde (pasiflik kavramı yok) rozet basılmaz.
// =============================================================================

/** `isActive` taşıyan kayıt — jenerik `T extends { id: string }` bunu bilmez. */
type MaybeSoftDeletable = { isActive?: unknown };

/**
 * Seçili kayıt pasif mi?
 *
 * `true` YALNIZ `isActive === false` iken. `undefined` (alan yok / henüz
 * yüklenmedi) → false: "bilmiyorum"u "pasif" diye basmak, aktif bir kartı
 * yanlışlıkla şaibeli göstermek olurdu.
 */
export function isPassiveRecord(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  return (record as MaybeSoftDeletable).isActive === false;
}

/** Tetikleyicide adın yanına basılan ek. */
export const PASSIVE_SUFFIX = " (pasif)";

/** Alanın altındaki tek satır uyarı — hatayı "Kaydet"ten ÖNCE söyler. */
export const PASSIVE_HINT =
  "Seçili kayıt PASİF. Kaydetmek bu alan yüzünden reddedilebilir — kartı aktifleştirin ya da başka kayıt seçin.";

/** Tetikleyici metni: seçili etiket + pasifse ek. Etiket yoksa dokunulmaz. */
export function decorateSelectedLabel(label: string | undefined, passive: boolean): string | undefined {
  if (!label) return label;
  return passive ? `${label}${PASSIVE_SUFFIX}` : label;
}
