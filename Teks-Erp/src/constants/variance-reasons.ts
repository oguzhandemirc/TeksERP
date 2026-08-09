// =============================================================================
// ÜRETİM SAPMASI — SEBEP KATALOĞU (2026-08-09)
// =============================================================================
// `RollVariance.reasonCode`'un TEK KAYNAĞI. Sapmanın türü (`RollVarianceKind`)
// "bu metraj fiziksel olarak var mıydı" sorusunu yanıtlar; sebep kodu "neden"
// sorusunu yanıtlar ve veriyi SAYILABİLİR yapar.
//
// NEDEN HAZIR SEÇENEK, neden serbest metin DEĞİL: emsal `mobil/src/constants/
// manualReasons.ts` (elle top ekleme). Eldivenli operatör vardiya ortasında
// tablet klavyesiyle metin yazmak istemiyor; pratikte "aaa" / "." gibi
// doldurmalar üretiyor ve o, boş bırakmaktan DAHA KÖTÜDÜR — denetimde cevap
// varmış gibi görünür, hiçbir şey söylemez. Serbest yazım kaldırılmadı,
// "Diğer"in altına alındı.
//
// ⚠️ SÜRTÜNME ÖLÇÜTÜ: sahada sürekli "Diğer" seçiliyorsa katalog YANLIŞTIR;
// gerçek serbest metinlere bakıp seçenekleri güncelle, listeyi BÜYÜTME.
//
// ⚠️ MOBİL AYNASI: `mobil/src/constants/varianceReasons.ts` bağımsız bir
// projedir ve bu dosyayı import EDEMEZ (izin katalogu / `permissions.ts` ile
// aynı durum). Kod eklerken orayı da güncelle — bekçi
// `scripts/test_roll_variance.ts` iki listenin BİREBİR aynı olduğunu mekanik
// doğrular, yani ayrışma derleme değil TEST hatası olarak düşer.
// =============================================================================

import { RollVarianceKind } from "@prisma/client";

/** Sapmayı doğuran YOL. Sebep "neden", kaynak "nerede" sorusunu yanıtlar. */
export const VARIANCE_SOURCES = {
  /** Tambur açık kumaş finalize'ı — kalan metraj kararı. */
  TAMBUR_FINALIZE: "TAMBUR_FINALIZE",
  /** Tambur "Top Kesme" (depo topu) kapanışı — kalan metraj kararı. */
  TAMBUR_WAREHOUSE_FINALIZE: "TAMBUR_WAREHOUSE_FINALIZE",
  /** Kesimlerin toplamı kayıtlı metrajı aştı (artı yön; sistem tespit eder). */
  TAMBUR_OVERCUT: "TAMBUR_OVERCUT",
  /** Finalize'dan SONRA tek parçanın iptali — metraj arşivdeki kaynağa dönemez. */
  TAMBUR_UNDO_SINGLE: "TAMBUR_UNDO_SINGLE",
  /**
   * Tümden geri almada geri konan metraj kayıtlı giriş metrajını AŞTI.
   * Aşımlı kesimde olur (operatör 500 m kayıtlı topu 545 m ölçtü) ve
   * `initialQty` yukarı çekilir — `currentQty > initialQty` gibi imkânsız bir
   * satır bırakmak yerine sapma kayda geçirilir.
   */
  TAMBUR_UNDO_FULL: "TAMBUR_UNDO_FULL",
} as const;

export type VarianceSource = (typeof VARIANCE_SOURCES)[keyof typeof VARIANCE_SOURCES];

export interface VarianceReason {
  code: string;
  label: string;
  /** true → operatörden serbest metin de istenir (`reasonText` zorunlu olur). */
  requiresText?: boolean;
}

/**
 * FİRE sebepleri — mal VARDI, kullanılamaz.
 *
 * Sektörel karşılık: SAP hurda sebep kodu (Ausschussgrund) — hurda hareketinde
 * ZORUNLUDUR, çünkü "fireniz neden %8" sorusunun cevabı sebep kırılımıdır.
 */
export const SCRAP_REASONS: readonly VarianceReason[] = [
  { code: "DOKUMA_HATASI", label: "Dokuma hatası" },
  { code: "BOYA_HATASI", label: "Boya / renk hatası" },
  { code: "LEKE", label: "Leke / kirlenme" },
  { code: "YIRTIK", label: "Yırtık / delik" },
  { code: "EN_HATASI", label: "En hatası" },
  { code: "MAKINE_HASARI", label: "Makine kaynaklı hasar" },
  { code: "DIGER", label: "Diğer", requiresText: true },
] as const;

/**
 * KAYIT DÜZELTMESİ sebepleri — mal HİÇ YOKTU, kayıt yanlıştı.
 *
 * ⚠️ Bu liste FİRE ile karıştırılmamalı. Buradaki her satır "sistemdeki sayı
 * yanlıştı" der; fire ise "mal vardı, çöpe gitti" der. Aynı kovaya atmak fire
 * oranını sistematik olarak şişirir (bkz. `RollVarianceKind` şema notu).
 */
export const RECORD_CORRECTION_REASONS: readonly VarianceReason[] = [
  { code: "OLCUM_HATASI", label: "Ölçüm hatası (metre yanlış okundu)" },
  { code: "GIRIS_FAZLA", label: "Girişte fazla metraj yazılmış" },
  { code: "MUKERRER_KAYIT", label: "Mükerrer kayıt" },
  { code: "YANLIS_TOP", label: "Yanlış top okutulmuş" },
  { code: "DIGER", label: "Diğer", requiresText: true },
] as const;

/** Serbest metnin alt sınırı — `manualReasons.MANUAL_MIN_REASON` ile aynı. */
export const VARIANCE_MIN_REASON_TEXT = 3;

/**
 * ESKİ İSTEMCİ İŞARETİ — seçilebilir bir sebep DEĞİLDİR.
 *
 * Sahadaki APK'lar sebep alanını bilmiyor. Sebebi katı biçimde zorunlu kılmak,
 * backend deploy edildiği anda eski tabletlerde "Bitir"i 400'e düşürürdü — yani
 * operatör vardiya ortasında işini KAPATAMAZDI. Bu, kaydı sebepsiz bırakmaktan
 * kat kat kötüdür.
 *
 * Bu yüzden sebep gönderilmemişse satır bu kodla yazılır: veri KAYBOLMAZ, ve
 * "belirtilmedi" raporda GÖRÜNÜR bir kova olur — sessiz NULL'dan farkı budur.
 * `reasonsForKind` onu DÖNDÜRMEZ, yani hiçbir seçicide çıkmaz.
 *
 * ⚠️ Sahadaki tüm tabletler yeni APK'ya geçtikten sonra bu kodun oranı düşmeli.
 * Düşmüyorsa yeni istemci sebebi göndermiyordur — katalog değil KABLOLAMA hatası.
 */
export const LEGACY_REASON_CODE = "BELIRTILMEDI";

/** Türe göre geçerli sebep listesi. OVERAGE sebep İSTEMEZ (sistem tespit eder). */
export function reasonsForKind(kind: RollVarianceKind): readonly VarianceReason[] {
  if (kind === RollVarianceKind.SCRAP) return SCRAP_REASONS;
  if (kind === RollVarianceKind.RECORD_CORRECTION) return RECORD_CORRECTION_REASONS;
  return [];
}

export interface VarianceReasonInput {
  reasonCode?: string | null;
  reasonText?: string | null;
}

/**
 * Sebep doğrulaması — TEK KAPI. Servis katmanı bunu çağırır, kendi `if`ini yazmaz.
 *
 * Sözleşme:
 *   • OVERAGE  → sebep İSTENMEZ (verilirse de kabul edilir; sistem tespitidir).
 *   • diğerleri → `reasonCode` ZORUNLU ve katalogda OLMALI.
 *   • `requiresText` işaretli kod ("Diğer") → `reasonText` en az 3 karakter.
 *
 * ⚠️ Bilinmeyen kodu SESSİZCE kabul etmek en kötü davranıştır: rapor kırılımında
 * "DIGER" kovasına düşmeyen, hiçbir yerde tanımlı olmayan bir etiket doğar ve
 * kimse fark etmez. Fail-closed.
 */
export function validateVarianceReason(
  kind: RollVarianceKind,
  input: VarianceReasonInput,
): { reasonCode: string | null; reasonText: string | null } {
  const code = input.reasonCode?.trim() || null;
  const text = input.reasonText?.trim() || null;

  if (kind === RollVarianceKind.OVERAGE) {
    return { reasonCode: code, reasonText: text };
  }

  // Sebepsiz çağrı = SEBEBİ BİLMEYEN eski istemci. Reddetmek yerine görünür bir
  // kovaya yazılır (bkz. LEGACY_REASON_CODE notu). Reddetmek, deploy penceresinde
  // sahadaki her tablette "Bitir"i kırardı.
  if (!code) return { reasonCode: LEGACY_REASON_CODE, reasonText: text };
  if (code === LEGACY_REASON_CODE) return { reasonCode: code, reasonText: text };

  const catalog = reasonsForKind(kind);
  const hit = catalog.find((r) => r.code === code);
  if (!hit) {
    throw new Error(
      `Geçersiz sebep kodu: ${code} (geçerli: ${catalog.map((r) => r.code).join(", ")})`,
    );
  }
  if (hit.requiresText && (!text || text.length < VARIANCE_MIN_REASON_TEXT)) {
    throw new Error(
      `"${hit.label}" seçildiğinde açıklama yazılmalı (en az ${VARIANCE_MIN_REASON_TEXT} karakter)`,
    );
  }
  return { reasonCode: code, reasonText: text };
}

/**
 * Eski `remainingAction` sözleşmesini sapma türüne çevirir.
 *
 * ⚠️ `discard` → RECORD_CORRECTION eşlemesi bu işin ÇEKİRDEĞİ: eski arayüz onu
 * "At (kayıp)" diye gösteriyordu ve "kayıp" kelimesi fire çağrıştırıyordu.
 * Veri modeli zaten doğruydu (`scrap` gerçek FIRE topu doğuruyor, `discard`
 * doğurmuyor) — yanlış olan ADIYDI ve raporu yanıltacak olan da oydu.
 *
 * `keep_*` sapma DEĞİLDİR: kalan metraj gerçek bir top olarak stoğa girer.
 */
export function varianceKindForRemainingAction(
  action: "keep_1kalite" | "keep_a1" | "scrap" | "discard",
): RollVarianceKind | null {
  if (action === "scrap") return RollVarianceKind.SCRAP;
  if (action === "discard") return RollVarianceKind.RECORD_CORRECTION;
  return null;
}
