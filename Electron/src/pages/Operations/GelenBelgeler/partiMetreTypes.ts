// Gülkesim parti no + kurşun metresi (tasarım 2026-11-02 §2.1–§2.4) — backend aynası tipler; `types.ts` yeniden dışa verir.
/** Gelen belgeden doğan partinin numarası — backend `BatchNumberSourceMode` aynası. */
export type BatchNumberSourceMode = "SERIES" | "DOCUMENT";
/** Onay kipi — backend `IncomingDocEntryMode` aynası. */
export type IncomingDocEntryMode = "PER_LINE" | "PER_DOCUMENT";
/** İşlem değeri çözülemeyen grupta oto iş emri — backend `AutoWorkOrderPatternlessMode` aynası. */
export type AutoWorkOrderPatternlessMode = "SKIP" | "OPEN";
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
}
/** Gönderen şablonu satırının parti no alanı (§2.4). */
export interface SenderTemplateBatchNoFields {
  /** Bu formda parti no hangi alan (onayda öğrenilir; panelden değişir/temizlenir). Eski backend göndermez. */
  batchNoKey?: string | null;
  /** Şablon tanımındaki parti no adayları (sıra = öneri sırası). Eski backend göndermez → sütun çizilmez. */
  batchNoCandidates?: SenderTemplateBatchNoCandidate[];
}
