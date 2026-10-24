// =============================================================================
// BASIM KONUSU + SONUÇ RAPORU — boğazın (`print.ts`) basım YAPMAYAN yarısı
// =============================================================================
// Konu yalnız kimlik taşır (içerik/PIN asla). PDF kaydı ve etiket doğrudan gönderimi sonucu burada
// rapora çevrilir; basan kod `print.ts`te kalır (bekçi: print-bogaz.test). Dışa `print.ts` üzerinden açılır.
// =============================================================================

import type { PdfSaveResult, SaveBatchResult } from "@shared/ipc-contract";
import { classifyLabelError, printErrorMessage, type LabelTransport, type PrintErrorCode } from "@/lib/print-error-codes";
import {
  appVersion,
  printJobService,
  type PrintJobAttachment,
  type PrintJobReport,
  type PrintOutputKind,
  type PrintStatus,
  type PrintSubjectKind,
  type PrintSubjectTable,
  type PrintTransport,
} from "@/services/printJobService";

/** Basılan şey — yalnız KİMLİK taşır; içerik (HTML, PIN, parola) rapora asla girmez. */
export interface PrintSubject {
  kind: PrintSubjectKind;
  table?: PrintSubjectTable;
  id?: string;
  ids?: string[];
  no?: string;
  docType?: string;
  printedDocumentId?: string;
  docVersion?: number;
  itemCount?: number;
}

/** Donmuş belgenin konusu: tür + (varsa) basılan sürüm. Sürüm yoksa (taslak) yalnız tür. */
export function frozenDocSubject(
  docType: string,
  doc?: { id?: string; version?: number; documentNo?: string } | null,
): PrintSubject {
  return {
    kind: "BELGE",
    docType,
    ...(doc?.id ? { printedDocumentId: doc.id, ...(doc.version !== undefined ? { docVersion: doc.version } : {}) } : {}),
    ...(doc?.documentNo ? { no: doc.documentNo } : {}),
  };
}

export function baseReport(subject: PrintSubject, outputKind: PrintOutputKind | undefined): Omit<PrintJobReport, "status"> {
  return {
    subjectKind: subject.kind,
    outputKind: outputKind ?? "PRINTER",
    subjectTable: subject.table,
    subjectId: subject.id,
    subjectIds: subject.ids,
    subjectNo: subject.no,
    docType: subject.docType,
    printedDocumentId: subject.printedDocumentId,
    docVersion: subject.docVersion,
    itemCount: subject.itemCount ?? (subject.ids?.length || undefined),
  };
}

/**
 * Electron PDF kaydı (`window.api.pdf.save/saveBatch`) — sonucu PDF türüyle bildirir ve AYNEN
 * döndürür: kaydedildi → ILETILDI, kaydet penceresi kapandı → IPTAL, hata → HATA.
 */
export async function trackPdfSave<R extends PdfSaveResult | SaveBatchResult>(
  subject: PrintSubject,
  run: () => Promise<R>,
): Promise<R> {
  const started = Date.now();
  let res: R;
  try {
    res = await run();
  } catch (err) {
    reportPdf(subject, { saved: false, error: "PDF hatası" }, Date.now() - started);
    throw err;
  }
  reportPdf(subject, res, Date.now() - started);
  return res;
}

function reportPdf(subject: PrintSubject, res: PdfSaveResult | SaveBatchResult, durationMs: number): void {
  const status: PrintStatus = res.saved ? "ILETILDI" : res.error ? "HATA" : "IPTAL";
  const count = "count" in res && typeof res.count === "number" && res.count > 0 ? res.count : undefined;
  printJobService.report({
    ...baseReport(subject, "PDF"),
    ...(count ? { itemCount: count } : {}),
    status,
    transport: "PDF_DOSYA",
    durationMs,
    ...(status === "HATA" ? { errorCode: "PDF_OLUSTURULAMADI", errorMessage: printErrorMessage("PDF_OLUSTURULAMADI") } : {}),
  });
}

// ─── Etiket doğrudan gönderimi (seri / TCP / CUPS / Windows kuyruğu) ─────────────

const LABEL_TRANSPORTS: Record<LabelTransport, PrintTransport> = {
  serial: "SERI",
  tcp: "TCP_9100",
  cups: "CUPS",
  winspool: "WINSPOOL",
};

export interface LabelSendTarget {
  transport: LabelTransport;
  /** COM yolu / IP / kuyruk adı — yazdırma geçmişinde "hangi yazıcı" sorusunun cevabı. */
  address?: string;
  peripheralId?: string;
  copies?: number;
}

/** Ham gönderim sonucu (`window.api.printer.send` ya da hazırlık adımı). */
export interface LabelSendResult {
  ok: boolean;
  bytes?: number;
  error?: string | null;
  /** Hazırlıkta bilinen sınıf (yapılandırma yok, dil yok…) — verilirse metinden sınıflanmaz. */
  errorCode?: PrintErrorCode;
}

/**
 * Etiket gönderim sonucunu bildirir. Başarıda iş ucu varsa (`workEndpoint`) rapor gitmez —
 * dönen künye iş ucunun gövdesine eklenir; hata HER ZAMAN `/print-jobs`a gider (kod + Türkçe mesaj).
 */
export function reportLabelSend(
  subject: PrintSubject,
  target: LabelSendTarget,
  res: LabelSendResult,
  opts: { durationMs?: number; workEndpoint?: boolean } = {},
): { printJob: PrintJobAttachment; errorCode?: PrintErrorCode } {
  const printJob: PrintJobAttachment = {
    transport: LABEL_TRANSPORTS[target.transport],
    ...(target.address ? { printerAddress: target.address.slice(0, 128) } : {}),
    ...(target.peripheralId ? { peripheralId: target.peripheralId } : {}),
    ...(opts.durationMs !== undefined ? { durationMs: Math.max(0, Math.round(opts.durationMs)) } : {}),
    ...(target.copies ? { copies: target.copies } : {}),
    ...(appVersion() ? { appVersion: appVersion() } : {}),
  };
  const errorCode = res.ok ? undefined : (res.errorCode ?? classifyLabelError(res.error, target.transport));
  if (!res.ok || !opts.workEndpoint) {
    printJobService.report({
      ...baseReport(subject, "PRINTER"),
      ...printJob,
      status: res.ok ? "ILETILDI" : "HATA",
      ...(res.bytes ? { bytes: res.bytes } : {}),
      ...(errorCode ? { errorCode, errorMessage: printErrorMessage(errorCode) } : {}),
    });
  }
  return { printJob, ...(errorCode ? { errorCode } : {}) };
}
