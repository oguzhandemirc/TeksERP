// Gülkesim parti no + kurşun metresi (tasarım 2026-11-02 §2.1–§2.4) — backend aynası tipler; `types.ts` yeniden dışa verir.
import type { PhotoRetentionMode } from "./photoRetentionTypes";
export type { ScanContentFields } from "./photoRetentionTypes";
/** Gelen belgeden doğan partinin numarası — backend `BatchNumberSourceMode` aynası. */
export type BatchNumberSourceMode = "SERIES" | "DOCUMENT";
/** Onay kipi — backend `IncomingDocEntryMode` aynası. */
export type IncomingDocEntryMode = "PER_LINE" | "PER_DOCUMENT";
/** İşlem değeri çözülemeyen grupta oto iş emri — backend `AutoWorkOrderPatternlessMode` aynası. */
export type AutoWorkOrderPatternlessMode = "SKIP" | "OPEN";
/** Belge kaydı kipi (K7) — SEPARATE: ayrı onay (bugünkü) · WITH_WORK_ORDER: iş emri formundan tek seferde. */
export type IncomingDocFormApproval = "SEPARATE" | "WITH_WORK_ORDER";
/** Çok partili belgeden iş emri (S1) — SINGLE: tek iş emri (bugünkü) · PER_PARTY: her parti ayrı. */
export type MultiPartyWorkOrderMode = "SINGLE" | "PER_PARTY";
/** Parti no adayı türü — motor `batchNoCandidates[].kind` aynası. */
export type BatchNoCandidateKind = "BARCODE" | "DOC" | "BATCH" | "WORK_ORDER" | "ORDER" | "FORM";
export interface SenderTemplateBatchNoCandidate {
  field: string;
  kind: BatchNoCandidateKind;
  /** Şablondaki alan etiketi (ör. "İş Emri No"); yoksa alan anahtarı gösterilir. */
  label?: string;
}
/** Gülkesim parti/metre §2.1 ayarları — üçü de eski backend'de yok (undefined = alan çizilmez, gövdeye girmez). */
export interface EntryModeSettings {
  batchNumberSource?: BatchNumberSourceMode;
  defaultBatchNumberSource?: BatchNumberSourceMode;
  entryMode?: IncomingDocEntryMode;
  defaultEntryMode?: IncomingDocEntryMode;
  autoWorkOrderPatternless?: AutoWorkOrderPatternlessMode;
  defaultAutoWorkOrderPatternless?: AutoWorkOrderPatternlessMode;
  formApproval?: IncomingDocFormApproval;
  defaultFormApproval?: IncomingDocFormApproval;
  multiPartyWorkOrder?: MultiPartyWorkOrderMode;
  defaultMultiPartyWorkOrder?: MultiPartyWorkOrderMode;
  /** İş emri açılınca refakat kartı kendiliğinden yazdırılır (K9; üretim ayarı, gelen belge ucunda döner; vars. false). */
  refakatAutoPrint?: boolean;
  /** İstasyon tabletinde "Belge okut" ile iş emri bulma (K17; vars. false). Eski backend göndermez → satır çizilmez. */
  stationDocLookup?: boolean;
  /** Belge fotoğrafı saklama (K28; vars. FULL). Eski backend göndermez → alan çizilmez. */
  photoRetention?: PhotoRetentionMode;
  defaultPhotoRetention?: PhotoRetentionMode;
}
/** Gönderen şablonu satırının parti no alanı (§2.4). */
export interface SenderTemplateBatchNoFields {
  /** S1: FILE = motor dosyası, USER = panelde/tablette tanıtılan (`u-…`); eski backend göndermez (koddan çıkarılır). */
  kind?: "FILE" | "USER";
  /** Bu formda parti no hangi alan (onayda öğrenilir; panelden değişir/temizlenir). Eski backend göndermez. */
  batchNoKey?: string | null;
  /** Şablon tanımındaki parti no adayları (sıra = öneri sırası). Eski backend göndermez → sütun çizilmez. */
  batchNoCandidates?: SenderTemplateBatchNoCandidate[];
}

// Belgeden parti no + kurşun metresi (Gülkesim, tasarım 2026-11-02 §2.2–2.5) — backend detay yanıtının AYNASI
// (`lib/gelen-belge/parti-no.ts`, `kursun-metre.ts`, `gelen-belge-kontrol.service.ts` `perDocumentGate`).
// Aday ve metre listesi sunucuda saklı okuma zarfından canlı türetilir; panel kural kurmaz, yalnız gösterir/seçer.

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
  /** K28 saklama kipi (onay ekranı belge no vurgusu); eski backend göndermez (undefined = FULL). */
  photoRetention?: PhotoRetentionMode;
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
