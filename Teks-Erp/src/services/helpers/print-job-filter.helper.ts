// Yazdırma geçmişi OKUMA süzgeci — liste, özet ve cursor TEK where kurucusundan (bekçi §4).
// Prisma çağrısı yok: sorgular print-job.service.ts'te.

import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readFilterList, readIdCondition } from "../../utils/query-parser";
import { resolveRangeEnd, resolveRangeStart } from "../../constants/time";
import {
  PRINT_OUTPUT_KINDS,
  PRINT_SOURCES,
  PRINT_STATUSES,
  PRINT_SUBJECT_KINDS,
  type PrintStatus,
} from "../../constants/print-subject-catalog";

export const PRINT_JOB_SELECT = {
  id: true,
  createdAt: true,
  userId: true,
  deviceRefId: true,
  source: true,
  outputKind: true,
  appVersion: true,
  stationId: true,
  machineId: true,
  subjectKind: true,
  docType: true,
  subjectTable: true,
  subjectId: true,
  subjectIds: true,
  subjectNo: true,
  printedDocumentId: true,
  docVersion: true,
  itemCount: true,
  copies: true,
  isReprint: true,
  transport: true,
  peripheralDeviceId: true,
  printerName: true,
  printerAddress: true,
  language: true,
  status: true,
  errorCode: true,
  errorMessage: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  bytes: true,
  meta: true,
  user: { select: { id: true, fullName: true, username: true } },
  device: { select: { id: true, name: true, kind: true } },
  peripheral: { select: { id: true, name: true, code: true } },
} satisfies Prisma.PrintJobSelect;

export type PrintJobDto = Prisma.PrintJobGetPayload<{ select: typeof PRINT_JOB_SELECT }>;

/** Okuma süzgeci — liste, özet ve cursor TEK where'den (bekçi §4). */
export interface PrintJobQuery {
  userId?: string | string[];
  peripheralDeviceId?: string | string[];
  printerName?: string | string[];
  deviceRefId?: string | string[];
  stationId?: string | string[];
  subjectKind?: string | string[];
  status?: string | string[];
  source?: string | string[];
  outputKind?: string | string[];
  subjectId?: string;
  gunBas?: string;
  gunBit?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Biçimsiz uuid P2007'ye düşmesin diye önce süzülür; koşul ortak `readIdCondition`dan.
function idCondition(field: string, raw: string | string[] | undefined): Prisma.PrintJobWhereInput | null {
  const bad = readFilterList(raw).find((v) => !UUID_RE.test(v));
  if (bad) throw AppError.badRequest(`Geçersiz kimlik süzgeci (${field}): ${bad}`, { code: "PRINT_FILTER_INVALID", field });
  const cond = readIdCondition(raw);
  return cond === null ? null : ({ [field]: cond } as Prisma.PrintJobWhereInput);
}

function enumCondition(field: string, raw: string | string[] | undefined, known: readonly string[]): Prisma.PrintJobWhereInput | null {
  const list = readFilterList(raw);
  if (list.length === 0) return null;
  const bad = list.find((v) => !known.includes(v));
  if (bad) throw AppError.badRequest(`Tanınmayan süzgeç değeri (${field}): ${bad}`, { code: "PRINT_FILTER_INVALID", field });
  return { [field]: list.length === 1 ? list[0] : { in: list } } as Prisma.PrintJobWhereInput;
}

/** Süzgeç → where. Tanınmayan değer 400 (fail-closed); gün sınırları FABRİKA gününden. */
export function buildPrintJobWhere(q: PrintJobQuery): Prisma.PrintJobWhereInput {
  const and: Prisma.PrintJobWhereInput[] = [];
  const push = (c: Prisma.PrintJobWhereInput | null) => {
    if (c) and.push(c);
  };
  push(idCondition("userId", q.userId));
  push(idCondition("peripheralDeviceId", q.peripheralDeviceId));
  push(idCondition("deviceRefId", q.deviceRefId));
  push(idCondition("stationId", q.stationId));
  push(enumCondition("subjectKind", q.subjectKind, PRINT_SUBJECT_KINDS));
  push(enumCondition("status", q.status, PRINT_STATUSES));
  push(enumCondition("source", q.source, PRINT_SOURCES));
  push(enumCondition("outputKind", q.outputKind, PRINT_OUTPUT_KINDS));
  const printers = readFilterList(q.printerName);
  if (printers.length > 0) and.push({ printerName: printers.length === 1 ? printers[0] : { in: printers } });
  if (q.subjectId) {
    if (!UUID_RE.test(q.subjectId)) throw AppError.badRequest("Geçersiz kayıt kimliği", { code: "PRINT_FILTER_INVALID", field: "subjectId" });
    // Belge baskısı konuyu değil belgeyi taşır (`printedDocumentId`) — belge detayından gelen süzgeç onu da kapsar.
    and.push({ OR: [{ subjectId: q.subjectId }, { subjectIds: { has: q.subjectId } }, { printedDocumentId: q.subjectId }] });
  }
  if (q.gunBas || q.gunBit) {
    const gte = q.gunBas ? resolveRangeStart(q.gunBas) : undefined;
    const lte = q.gunBit ? resolveRangeEnd(q.gunBit) : undefined;
    if ((gte && Number.isNaN(gte.getTime())) || (lte && Number.isNaN(lte.getTime()))) {
      throw AppError.badRequest("Geçersiz tarih aralığı (YYYY-AA-GG)", { code: "PRINT_FILTER_INVALID", field: "gun" });
    }
    and.push({ createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } });
  }
  return and.length > 0 ? { AND: and } : {};
}

export const PRINT_JOB_PAGE_DEFAULT = 50;
export const PRINT_JOB_PAGE_MAX = 200;

export interface PrintJobSummary {
  toplam: number;
  durum: Record<PrintStatus, number>;
  /** Yalnız `ILETILDI` — `SIMULE` başarı SAYILMAZ. */
  basarili: number;
  pdf: number;
  enCokHata: { peripheralDeviceId: string | null; printerName: string | null; sayi: number } | null;
}
