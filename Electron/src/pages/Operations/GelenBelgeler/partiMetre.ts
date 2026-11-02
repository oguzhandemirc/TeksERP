// Parti no + kurşun metresi yüzeyinin saf parçaları (yalnız GÖSTERİM): hüküm backend'de (B ön kontrolü), burada
// ayar aynası sayaç ve Türkçe metin. Kip `entryMode` alanı yoksa (eski backend) PER_LINE = bugünkü davranış.
import { formatNumber } from "@/lib/format";
import type { BatchNoCandidateKind, EntryMode, KursunMeterCandidate, KursunMeterCandidates, KursunMetersSource } from "./partiMetreTypes";
import type { DeliveryNoteHeader, IncomingDocumentSettings } from "./types";

export function entryModeOf(settings: (IncomingDocumentSettings & { entryMode?: EntryMode }) | null | undefined): EntryMode {
  return settings?.entryMode === "PER_DOCUMENT" ? "PER_DOCUMENT" : "PER_LINE";
}

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

/** Metre kaynağının sayısı; yoksa/okunamazsa null. `lineSum` çıplak sayı/metin de gelebilir. */
export function meterValue(c: KursunMeterCandidate | number | string | null | undefined): number | null {
  if (c == null) return null;
  const raw = typeof c === "object" ? c.value : c;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const fmtMeters = (n: number | string | null | undefined): string => `${formatNumber(n, 3)} m`;

/** Seçili kaynağın aday kaydı (kırpık için); MANUAL / bilinmeyen kaynakta null. */
export function sourceCandidate(src: KursunMetersSource | null | undefined, c: KursunMeterCandidates | null | undefined): KursunMeterCandidate | null {
  if (!c || !src) return null;
  const pick = src === "OUTPUT" ? c.output : src === "TOTAL" ? c.total : src === "LINE_SUM" ? c.lineSum : null;
  return pick && typeof pick === "object" ? pick : null;
}

type PerDocNote = Pick<DeliveryNoteHeader, "kursunMeters" | "kursunMetersReview" | "ourBatchNo">;

/** Onay diyaloğu özeti: "1 kayıt · 4521 m · parti 214279" (parti boşsa seriden doğar). */
export function perDocumentSummary(note: PerDocNote): string {
  const m = meterValue(note.kursunMeters ?? null);
  const parts = ["1 kayıt", m !== null && m > 0 ? fmtMeters(m) : "metre yok"];
  parts.push(note.ourBatchNo ? `parti ${note.ourBatchNo}` : "parti numarası seriden doğacak");
  return parts.join(" · ");
}

export interface PerDocumentPrecheck {
  blocked: boolean;
  messages: Array<{ tone: "info" | "warn" | "block"; text: string }>;
}

/**
 * PER_DOCUMENT ön kontrol sayacı — backend B ön kontrolünün aynası (satır kapıları bu kipte uygulanmaz): metre > 0
 * şart; review açıkken `unreviewedApproval` WARN geçer, BLOCK/BLOCK_SUSPECT engeller. Ayar okunamadıysa hüküm yok.
 */
export function perDocumentPrecheck(note: PerDocNote, settings: IncomingDocumentSettings | null | undefined): PerDocumentPrecheck {
  const messages: PerDocumentPrecheck["messages"] = [];
  let blocked = false;
  const m = meterValue(note.kursunMeters ?? null);
  if (m === null || !(m > 0)) {
    blocked = true;
    messages.push({ tone: "block", text: "Kurşun metresi yok — önce metreyi girin." });
  } else if (note.kursunMetersReview && settings) {
    if (settings.unreviewedApproval === "WARN") messages.push({ tone: "warn", text: "Kurşun metresi gözden geçirilmedi — onay uyarıyla geçer." });
    else {
      blocked = true;
      messages.push({ tone: "block", text: "Kurşun metresi gözden geçirilmeli — onay engellenir." });
    }
  }
  if (!note.ourBatchNo) messages.push({ tone: "info", text: "Parti no seçilmedi — parti numarası seriden doğacak." });
  return { blocked, messages };
}
