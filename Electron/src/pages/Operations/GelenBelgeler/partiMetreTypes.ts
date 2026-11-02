// Belgeden parti no + kurşun metresi (Gülkesim, tasarım 2026-11-02 §2.2–2.4) — backend detay yanıtının AYNASI.
// Aday ve metre listesi sunucuda saklı okuma zarfından canlı türetilir; panel kural kurmaz, yalnız gösterir/seçer.
import type { OcrRect } from "./types";

/** Onay kipi (`gelenBelge.entryMode`): PER_LINE her satır bir top (bugünkü) · PER_DOCUMENT belge başına tek kayıt. */
export type EntryMode = "PER_LINE" | "PER_DOCUMENT";
export type BatchNoCandidateKind = "BARCODE" | "DOC" | "BATCH" | "WORK_ORDER" | "ORDER" | "FORM";
export type KursunMetersSource = "OUTPUT" | "TOTAL" | "LINE_SUM" | "MANUAL";

export interface BatchNoCandidate {
  /** Şablon alan anahtarı (`isEmriNo`…) — PATCH `ourBatchNoKey`. */
  key: string;
  kind: BatchNoCandidateKind;
  /** Kâğıttaki etiket ("İş Emri", "SEVK NO"…); yoksa anahtar gösterilir. */
  label?: string | null;
  value: string;
  /** Bu formda hatırlanan anahtar mı (`SenderTemplate.batchNoKey`). */
  remembered?: boolean;
  rect?: OcrRect | null;
  scanId?: string | null;
}

/** Tek metre kaynağı; değer Decimal metni ya da sayı gelebilir. */
export interface KursunMeterCandidate {
  value: string | number;
  key?: string | null;
  label?: string | null;
  rect?: OcrRect | null;
  scanId?: string | null;
}
export interface KursunMeterCandidates {
  output?: KursunMeterCandidate | null;
  total?: KursunMeterCandidate | null;
  input?: KursunMeterCandidate | null;
  lineSum?: KursunMeterCandidate | number | string | null;
}

/** Başlık kolonları (S0) — eski backend göndermez → undefined (kart çizilmez). */
export interface PartiMetreHeaderFields {
  /** Seçilen parti no + aday anahtarı (`MANUAL` = elle). */
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  /** Kurşun metresi (Decimal → metin) + kaynağı + gözden geçirme işareti. */
  kursunMeters?: string | null;
  kursunMetersSource?: KursunMetersSource | null;
  kursunMetersReview?: boolean;
}
/** Detay yanıtı (A): saklı okuma zarfından canlı türetilir. */
export interface PartiMetreDetailFields {
  batchNoCandidates?: BatchNoCandidate[];
  kursunMeterCandidates?: KursunMeterCandidates | null;
}
/** Başlık PATCH ekleri (B). */
export interface PartiMetrePatch {
  /** Elle kurşun metresi (kaynak `MANUAL`, review düşer). */
  kursunMeters?: number;
  /** Okunan değeri olduğu gibi onayla (review düşer, değer değişmez). */
  kursunMetersReviewed?: true;
}
