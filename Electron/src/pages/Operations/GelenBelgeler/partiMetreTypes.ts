// Belgeden parti no + kurşun metresi (Gülkesim, tasarım 2026-11-02 §2.2–2.5) — backend detay yanıtının AYNASI
// (`lib/gelen-belge/parti-no.ts`, `kursun-metre.ts`, `gelen-belge-kontrol.service.ts` `perDocumentGate`).
// Aday ve metre listesi sunucuda saklı okuma zarfından canlı türetilir; panel kural kurmaz, yalnız gösterir/seçer.

export type BatchNoCandidateKind = "BARCODE" | "DOC" | "BATCH" | "WORK_ORDER" | "ORDER" | "FORM";
export type KursunMetersSource = "OUTPUT" | "TOTAL" | "LINE_SUM" | "MANUAL";

export interface BatchNoCandidate {
  /** Şablon alan anahtarı (`isEmriNo`…) — PATCH `ourBatchNoKey`. */
  key: string;
  kind: BatchNoCandidateKind;
  /** Kâğıttaki etiket ("İş Emri", "SEVK NO"…). */
  label: string;
  value: string;
}

/** Metre kaynakları (Decimal metni; yoksa null). Giriş yalnız bilgi. */
export interface KursunMeterCandidates {
  output: string | null;
  total: string | null;
  input: string | null;
  lineSum: string | null;
}

/** Onayın PER_DOCUMENT kapı hükmü — yalnız kip açıkken detayda doğar (PER_LINE yanıtında anahtar yok). */
export interface PerDocumentGate {
  code: "KURSUN_METERS_REQUIRED" | "KURSUN_METERS_REVIEW_PENDING" | null;
  warnings: string[];
  /** Toplam kapısı yalnız kaynak LINE_SUM iken kapı, aksi uyarı. */
  totalsBlocking: boolean;
}

/** Başlık kolonları (S0) — eski backend göndermez → undefined. */
export interface PartiMetreHeaderFields {
  /** Seçilen parti no + aday anahtarı (`MANUAL` = elle). */
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  /** Kurşun metresi (Decimal → metin) + kaynağı + gözden geçirme işareti. */
  kursunMeters?: string | null;
  kursunMetersSource?: KursunMetersSource | null;
  kursunMetersReview?: boolean;
}
/** Detay yanıtı (A: adaylar + metre kaynakları canlı; B: `perDocument` kip açıkken). */
export interface PartiMetreDetailFields {
  batchNoCandidates?: BatchNoCandidate[];
  kursunMeterCandidates?: KursunMeterCandidates | null;
  perDocument?: PerDocumentGate;
}
/** Başlık PATCH ekleri (B). Elle parti no anahtarsız gider (sunucu `MANUAL` yazar; `MANUAL` gönderilemez). */
export interface PartiMetrePatch {
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  /** Elle kurşun metresi (kaynak `MANUAL`, review düşer). */
  kursunMeters?: number;
  /** Okunan değeri onayla (kaynak `MANUAL`, review düşer, değer değişmez). */
  kursunMetersReviewed?: true;
}
