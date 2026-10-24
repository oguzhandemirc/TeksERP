// Basım satırı GİRDİ sözleşmesi — iş uçlarının `printJob` eki, `POST /api/print-jobs` gövdesi ve
// normalize satır girdisi. Prisma çağrısı yok: `prisma.printJob` yalnız print-job.service.ts'te (bekçi §10).

import { Prisma, PrintedDocType, PrinterLanguage } from "@prisma/client";
import { z } from "zod";
import {
  PRINT_META_MAX_BYTES,
  PRINT_OUTPUT_KINDS,
  PRINT_SOURCES,
  PRINT_STATUSES,
  PRINT_SUBJECT_IDS_MAX,
  PRINT_SUBJECT_META_DROPPED,
  PRINT_TRANSPORTS,
  type PrintOutputKind,
  type PrintStatus,
  type PrintSubjectKind,
  type PrintTransport,
} from "../../constants/print-subject-catalog";
import type { PrintJobRequestContext } from "./print-job-context.helper";

// ─── Sözleşme ───────────────────────────────────────────────────────────────

/**
 * İş ucunun gövdesine İSTEĞE BAĞLI eklenen basım künyesi (`printJob` alt nesnesi). Eski istemci
 * göndermez → satır `ILETILDI` + `transport=null` doğar. Tanınmayan anahtar sessizce elenir
 * (yeni istemci + eski backend ileri uyumu); istemci tipinde de aynı alanlar durur (iki uç).
 */
export const printJobAttachmentSchema = z.object({
  clientToken: z.string().uuid("Geçersiz basım kimliği").optional(),
  transport: z.enum(PRINT_TRANSPORTS).optional(),
  printerName: z.string().max(120).optional(),
  printerAddress: z.string().max(128).optional(),
  peripheralId: z.string().uuid("Geçersiz yazıcı ID").optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  copies: z.number().int().min(1).max(1000).optional(),
  appVersion: z.string().max(32).optional(),
});
export type PrintJobAttachment = z.infer<typeof printJobAttachmentSchema>;

/** `POST /api/print-jobs` gövdesi — istemcinin kendi bildirdiği basım (hata · iptal · PDF · belge). */
export const printJobReportSchema = printJobAttachmentSchema
  .extend({
    clientToken: z.string().uuid("Geçersiz basım kimliği"),
    subjectKind: z.string().min(1).max(40),
    status: z.enum(PRINT_STATUSES, "Basım sonucu ILETILDI · HATA · IPTAL · BELIRSIZ · SIMULE olmalı"),
    source: z.enum(PRINT_SOURCES).optional(),
    outputKind: z.enum(PRINT_OUTPUT_KINDS).optional(),
    docType: z.enum(PrintedDocType).optional(),
    subjectTable: z.string().max(48).optional(),
    subjectId: z.string().uuid("Geçersiz kayıt ID").optional(),
    subjectIds: z.array(z.string().uuid("Geçersiz kayıt ID")).max(PRINT_SUBJECT_IDS_MAX).optional(),
    subjectNo: z.string().max(64).optional(),
    printedDocumentId: z.string().uuid().optional(),
    docVersion: z.number().int().min(0).optional(),
    itemCount: z.number().int().min(1).max(100_000).optional(),
    isReprint: z.boolean().optional(),
    language: z.enum(PrinterLanguage).optional(),
    errorCode: z.string().min(1).max(60).optional(),
    errorMessage: z.string().max(2000).optional(),
    startedAt: z.iso.datetime().optional(),
    finishedAt: z.iso.datetime().optional(),
    bytes: z.number().int().min(0).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((b) => b.status !== "HATA" || !!b.errorCode, {
    message: "Hatalı basımda hata kodu (errorCode) zorunlu",
    path: ["errorCode"],
  });
export type PrintJobReport = z.infer<typeof printJobReportSchema>;

/** Gövde tavanı (bayt) — tablet kuyruğu çevrimdışı birikip toplu boşalsa da satır başına küçük kalır. */
export const PRINT_JOB_BODY_MAX_BYTES = 8 * 1024;

/** Satıra yazılacak normalize girdi — tüm yollar bu biçimden geçer. */
export interface PrintJobInput {
  ctx: PrintJobRequestContext;
  subjectKind: PrintSubjectKind;
  status: PrintStatus;
  outputKind?: PrintOutputKind;
  transport?: PrintTransport | null;
  clientToken?: string | null;
  docType?: PrintedDocType | null;
  subjectTable?: string | null;
  subjectId?: string | null;
  subjectIds?: string[];
  subjectNo?: string | null;
  printedDocumentId?: string | null;
  docVersion?: number | null;
  itemCount?: number;
  copies?: number;
  isReprint?: boolean | null;
  peripheralDeviceId?: string | null;
  printerName?: string | null;
  printerAddress?: string | null;
  language?: PrinterLanguage | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
  bytes?: number | null;
  meta?: Record<string, unknown> | null;
}

/** İş ucunun sabit konusu + istemcinin isteğe bağlı künyesi → satır girdisi. */
export function fromAttachment(
  ctx: PrintJobRequestContext,
  attachment: PrintJobAttachment | undefined,
  subject: Omit<PrintJobInput, "ctx" | "status"> & { status?: PrintStatus },
): PrintJobInput {
  return {
    ...subject,
    ctx: { ...ctx, appVersion: attachment?.appVersion ?? ctx.appVersion },
    status: subject.status ?? "ILETILDI",
    clientToken: attachment?.clientToken ?? null,
    transport: attachment?.transport ?? subject.transport ?? null,
    printerName: attachment?.printerName ?? subject.printerName ?? null,
    printerAddress: attachment?.printerAddress ?? subject.printerAddress ?? null,
    peripheralDeviceId: attachment?.peripheralId ?? subject.peripheralDeviceId ?? null,
    durationMs: attachment?.durationMs ?? subject.durationMs ?? null,
    copies: attachment?.copies ?? subject.copies,
  };
}

export const clip = (v: string | null | undefined, max: number): string | null =>
  v == null ? null : v.length > max ? v.slice(0, max) : v;

/** `meta` ≤2 KB; aşan yük atılır ve yalnız boyutu kalır. Kimlik kartında hiç yazılmaz. */
export function normalizeMeta(kind: PrintSubjectKind, meta: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (PRINT_SUBJECT_META_DROPPED.has(kind) || !meta) return undefined;
  const json = JSON.stringify(meta);
  const size = Buffer.byteLength(json, "utf8");
  if (size <= PRINT_META_MAX_BYTES) return meta as Prisma.InputJsonValue;
  return { kirpildi: true, boyut: size };
}
