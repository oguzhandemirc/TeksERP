// Parti no + kurşun metresi yüzeyinin saf parçaları (yalnız GÖSTERİM): kip ve kapı hükmü backend detayındaki
// `perDocument`ten (onayla aynı `perDocumentGate`); alan yoksa (PER_LINE / eski backend) bugünkü görünüm.
import { formatNumber } from "@/lib/format";
import type { BatchNoCandidateKind, KursunMetersSource, PerDocumentGate } from "./partiMetreTypes";
import type { DeliveryNoteDetail, DeliveryNoteHeader } from "./types";

/** Kartlar, bilgi satırları ve onay özeti yalnız sunucu PER_DOCUMENT kapısını gönderdiğinde. */
export const showsPerDocument = (n: Pick<DeliveryNoteDetail, "perDocument">): boolean => n.perDocument != null;

export const KURSUN_SOURCE_LABEL: Record<KursunMetersSource, string> = {
  OUTPUT: "Çıkış metresi",
  TOTAL: "Toplam metre",
  LINE_SUM: "Satır toplamı",
  MANUAL: "Elle",
};

export const BATCH_KIND_LABEL: Record<BatchNoCandidateKind, string> = {
  BARCODE: "Barkod",
  DOC: "Evrak no",
  BATCH: "Parti no",
  WORK_ORDER: "İş emri",
  ORDER: "Sipariş",
  FORM: "Form sıra no",
};

/** Decimal metni → sayı; yoksa/okunamazsa null. */
export function meterValue(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const fmtMeters = (n: number | string | null | undefined): string => `${formatNumber(n, 3)} m`;

type PerDocNote = Pick<DeliveryNoteHeader, "kursunMeters" | "ourBatchNo">;

/** Onay diyaloğu özeti: "1 kayıt · 4521 m · parti 214279" (parti boşsa seriden doğar). */
export function perDocumentSummary(note: PerDocNote): string {
  const m = meterValue(note.kursunMeters);
  const parts = ["1 kayıt", m !== null && m > 0 ? fmtMeters(m) : "metre yok"];
  parts.push(note.ourBatchNo ? `parti ${note.ourBatchNo}` : "parti numarası seriden doğacak");
  return parts.join(" · ");
}

const GATE_TEXT: Record<NonNullable<PerDocumentGate["code"]>, string> = {
  KURSUN_METERS_REQUIRED: "Kurşun metresi yok — önce metreyi girin.",
  KURSUN_METERS_REVIEW_PENDING: "Kurşun metresi gözden geçirilmeli — onay engellenir.",
};

/** Diyalog sayacı: sunucunun kapı hükmünü (`perDocument.code` + `warnings`) Türkçe satıra çevirir; kural kurmaz. */
export function perDocumentPrecheck(note: PerDocNote, gate: PerDocumentGate): { blocked: boolean; messages: Array<{ tone: "info" | "warn" | "block"; text: string }> } {
  const messages: Array<{ tone: "info" | "warn" | "block"; text: string }> = [];
  if (gate.code) messages.push({ tone: "block", text: GATE_TEXT[gate.code] ?? gate.code });
  for (const w of gate.warnings) messages.push({ tone: "warn", text: w });
  if (!note.ourBatchNo) messages.push({ tone: "info", text: "Parti no seçilmedi — parti numarası seriden doğacak." });
  return { blocked: gate.code !== null, messages };
}
