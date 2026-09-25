// =============================================================================
// ÇEK / SENET TESLİM BORDROSU — seçim kuralları (ekran katmanı)
// =============================================================================
// Bordronun KÂĞIDI panelde üretilmez (K1, 2026-09-26): taslak da resmî BRD de
// backend'in tek belge çözücüsünden gelir, Excel aynı kolon tanımından türer
// (`cheque-delivery-note.service` → `renderChequeDeliveryNote{Html,Tables}`).
// Burada yalnız SEÇİMİN kuralları yaşar; backend aynı kuralları fail-closed
// uygular — ekran nezakettir, kuralı koruyan üreticidir.
//
// ⚠️ BİR BORDRO TEK YÖN TAŞIR (aldığımız ⊻ verdiğimiz): karışık seçimde TOPLAM
// iki ayrı şey demeye başlar ve "teslim alan" imzası neyin teslim alındığını
// söylemez olur. İlk seçim yönü kilitler (`selectionKind`), karşı yön kutusu
// sebebiyle kapanır (`selectionBlockReason`).
//
// ⚠️ İPTAL EDİLMİŞ KAYIT BORDROYA GİREMEZ — resmen "yok" sayılmış bir kâğıdı
// teslim edilenler listesine yazmak, var olmayan bir kıymet için imza attırmaktır.
// =============================================================================

import { KIND_LABEL } from "./labels";
import { toNum, type ChequeKind, type ChequeRow } from "./service";

/** Seçim kuralları yalnız bu üç alana bakar — tam satır gerekmez. */
export type SelectableCheque = Pick<ChequeRow, "id" | "kind" | "status">;

export const BORDRO_MIXED_KIND_ERROR =
  "Bir teslim bordrosu TEK YÖN taşır: aldığımız çek/senetler ile verdiğimiz çek/senetler aynı bordroya giremez.";

export const BORDRO_EMPTY_ERROR = "Bordro için listeden en az bir çek/senet seçin.";

// -----------------------------------------------------------------------------
// SEÇİM KURALLARI (ekran katmanı)
// -----------------------------------------------------------------------------

/**
 * Seçimin KİLİTLEDİĞİ yön — seçim boşken `null` (her iki yön de serbest).
 *
 * Kilidi ilk seçilen satır kurar; kural bundan sonra "aynı yön" der. Yönü
 * seçimin ortasında değiştirmek sessizce bir satırı düşürmek ya da iki yönü
 * karıştırmak demekti — ikisi de kullanıcının fark edemeyeceği kayıplar.
 */
export function selectionKind(selected: readonly Pick<ChequeRow, "kind">[]): ChequeKind | null {
  return selected[0]?.kind ?? null;
}

/**
 * Bu satır seçime EKLENEMİYORSA sebebi; eklenebiliyorsa `null`.
 *
 * ⚠️ Sebep DÖNDÜRÜLÜR, `false` değil: kapalı bir kutu tek başına "bozuk"
 * okunur. Ekran kutuyu kapatırken bu cümleyi de yazar.
 */
export function selectionBlockReason(
  row: Pick<SelectableCheque, "kind" | "status">,
  lockedKind: ChequeKind | null,
): string | null {
  if (row.status === "CANCELLED") {
    return "İptal edilmiş kayıt teslim bordrosuna giremez — bu kâğıt resmen yok sayıldı.";
  }
  if (lockedKind && row.kind !== lockedKind) {
    return `Seçim “${KIND_LABEL[lockedKind]}” çek/senetlerle kilitlendi — bir bordro tek yön taşır. Diğer yön için önce seçimi temizleyin.`;
  }
  return null;
}

/**
 * "Sayfadakilerin tümünü seç" — TEK YÖN kuralına uyar.
 *
 * ⚠️ ATLANAN SATIR SAYISI GERİ DÖNER ve ekranda YAZILIR. Kilitli yön yokken
 * ilk uygun satırın yönü kilit olur; sayfada karışık yön varsa seçim tanım
 * gereği KISMİDİR. "Tümünü seçtim" deyip sessizce yarısını almak, bu projede
 * yazılı olan en kötü toplu-işlem davranışıdır (bkz. kök CLAUDE.md, toplu
 * kurşun dağıtımı: atlanan her satır somut sebebiyle döner).
 */
export function selectAllIds(
  rows: readonly SelectableCheque[],
  lockedKind: ChequeKind | null,
): { ids: string[]; kind: ChequeKind | null; skipped: number } {
  const kind = lockedKind ?? rows.find((r) => r.status !== "CANCELLED")?.kind ?? null;
  if (!kind) return { ids: [], kind: null, skipped: rows.length };
  const ids = rows.filter((r) => selectionBlockReason(r, kind) === null).map((r) => r.id);
  return { ids, kind, skipped: rows.length - ids.length };
}

// -----------------------------------------------------------------------------
// DÜĞME KAPISI
// -----------------------------------------------------------------------------

/**
 * Bu seçimden bordro (taslak ya da kayıt) istenemiyorsa sebebi; istenebiliyorsa `null`.
 *
 * Backend'in `loadSelectionTx` kapısının ekrandaki ikizi: ayrışırlarsa düğme
 * "yapılabilir" derken sunucu 400 döner (ya da tersi, ekran meşru seçimi engeller).
 */
export function bordroBlockReason(
  rows: readonly Pick<SelectableCheque, "kind" | "status">[],
): string | null {
  if (rows.length === 0) return BORDRO_EMPTY_ERROR;
  const cancelled = rows.filter((r) => r.status === "CANCELLED").length;
  if (cancelled > 0) {
    return `Seçimde ${cancelled} iptal edilmiş kayıt var — iptal edilen çek/senet teslim bordrosuna giremez.`;
  }
  if (new Set(rows.map((r) => r.kind)).size > 1) return BORDRO_MIXED_KIND_ERROR;
  return null;
}

// -----------------------------------------------------------------------------
// ÖZET (diyalogdaki ara toplam şeridi)
// -----------------------------------------------------------------------------

/**
 * Kuruşa yuvarlanmış toplam — ham `reduce` ikili kayan noktada
 * `16500.499999999996` gibi bir hücre değeri üretir: `numFmt` onu ekranda
 * düzeltir ama ondalık basamağı açan muhasebecinin dosyaya güveni biter.
 */
function sum2(values: number[]): number {
  return Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
}

/** Para birimi bazında adet + toplam — ilk görülme sırasında (deterministik). */
export function totalsByCurrency(
  rows: readonly Pick<ChequeRow, "currency" | "amount">[],
): Array<{ currency: string; count: number; total: number }> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const bucket = map.get(r.currency) ?? [];
    bucket.push(toNum(r.amount));
    map.set(r.currency, bucket);
  }
  return [...map].map(([currency, values]) => ({
    currency,
    count: values.length,
    total: sum2(values),
  }));
}
