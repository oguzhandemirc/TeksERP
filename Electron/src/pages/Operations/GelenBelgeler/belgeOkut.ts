// İş emri ekranından "Belge okut" (tasarım 2026-11-02 P3) — saf karar parçaları. Kural sunucudadır: buradaki kapı yalnız
// düğmenin ne diyeceğini seçer (onay sunucuda yine ön kontrolden geçer); kurşun metresi review'lıyken bu yol DAİMA bekler.
import { TERIM } from "@/lib/terim";
import { PDF_MIME } from "./uploadPrep";
import type { AutoWorkOrderResult } from "./workOrderTypes";

export type BelgeOkutStage = "READING" | "READ_FAILED" | "READY" | "CLOSED";

interface ScanLike {
  mimeType: string;
  status: string;
}

/** Okunabilir sayfa okunurken READING; hiçbiri okunamadıysa READ_FAILED; belge taslak/kısmi değilse CLOSED. */
export function belgeOkutStage(note: { status: string; scans: readonly ScanLike[] }): BelgeOkutStage {
  if (note.status !== "DRAFT" && note.status !== "PARTIAL") return "CLOSED";
  const readable = note.scans.filter((s) => s.mimeType !== PDF_MIME);
  if (readable.some((s) => s.status === "PENDING" || s.status === "READING")) return "READING";
  if (readable.length > 0 && readable.every((s) => s.status === "READ_FAILED")) return "READ_FAILED";
  return "READY";
}

export type BelgeOkutAction = "APPROVE" | "SAVE_DRAFT" | "OPEN_IN_LIST";

export interface BelgeOkutGate {
  action: BelgeOkutAction;
  blocked: boolean;
  reasons: string[];
}

interface GateNote {
  status: string;
  ownerCustomerId: string | null;
  kursunMeters?: string | number | null;
  kursunMetersReview?: boolean;
}

/**
 * Onay kartının düğmesi. İzin yoksa "taslak olarak kaydet" (onay çağrılmaz — fail-closed, sessiz atlama yok);
 * PER_LINE kipinde satırlar Gelen Belgeler'de gözden geçirilir; PER_DOCUMENT'ta müşteri + metre şart, review'lı metre bekler.
 */
export function belgeOkutGate(note: GateNote, opts: { canApprove: boolean; entryMode: string }): BelgeOkutGate {
  if (!opts.canApprove) {
    return { action: "SAVE_DRAFT", blocked: false, reasons: [`Onay yetkiniz yok: taslak kaydedilir, ${TERIM.terbiyeIsEmri.tekilKucuk} yetkili kişi belgeyi onaylayınca açılır.`] };
  }
  if (opts.entryMode !== "PER_DOCUMENT") {
    return { action: "OPEN_IN_LIST", blocked: false, reasons: ["Bu fabrikada belge satır satır onaylanır; satırları Gelen Belgeler ekranında gözden geçirin."] };
  }
  const reasons: string[] = [];
  if (note.status !== "DRAFT" && note.status !== "PARTIAL") reasons.push("Belge artık onaylanabilir durumda değil.");
  if (!note.ownerCustomerId) reasons.push("Müşteriyi seçin.");
  const m = note.kursunMeters == null || note.kursunMeters === "" ? null : Number(note.kursunMeters);
  if (m === null || !Number.isFinite(m) || !(m > 0)) reasons.push("Kurşun metresi yok — metreyi girin.");
  else if (note.kursunMetersReview) reasons.push("Kurşun metresini doğrulayın (kılavuzlu giriş).");
  return { action: "APPROVE", blocked: reasons.length > 0, reasons };
}

/** Onaydan sonra gidilecek iş emri: yalnız TEK açılan varsa (birden çoksa operatör sonuç listesinden seçer). */
export function openedWorkOrderId(r: AutoWorkOrderResult | null | undefined): string | null {
  const opened = (r?.groups ?? []).filter((g) => g.outcome === "OPENED" && g.workOrderId);
  return opened.length === 1 ? opened[0]!.workOrderId! : null;
}
