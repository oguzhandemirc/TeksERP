// =============================================================================
// TeksERP - Print Job Controller (yazdırma geçmişi, izlenebilirlik A1)
// =============================================================================
// Kullanıcı ve cihaz İSTEKTEN çözülür (token/başlık), gövdeden asla. Satırı yalnız
// `print-job.service` yazar; burada yalnız doğrulama, gövde tavanı ve hız sınırı var.

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  PRINT_JOB_BODY_MAX_BYTES,
  buildPrintJobWhere,
  getPrintJob,
  listPrintJobs,
  printJobReportSchema,
  reportPrintJob,
  summarizePrintJobs,
  type PrintJobQuery,
} from "../services/print-job.service";
import { resolvePrintJobContext } from "../services/helpers/print-job-context.helper";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

const idSchema = z.string().uuid("Geçersiz basım kaydı ID");

/** Kullanıcı başına dakikalık bildirim tavanı — çevrimdışı kuyruk boşalırken bile aşılmayacak kadar geniş. */
export const PRINT_JOB_REPORTS_PER_MINUTE = 120;
const WINDOW_MS = 60_000;
const recentReports = new Map<string, number[]>();

// Tek süreçte bellek-içi kayan pencere; reddedilen istek sayılmaz (web-hardening emsali).
function assertReportRate(userId: string, now: number): void {
  const live = (recentReports.get(userId) ?? []).filter((t) => t > now - WINDOW_MS);
  if (live.length >= PRINT_JOB_REPORTS_PER_MINUTE) {
    recentReports.set(userId, live);
    throw AppError.tooManyRequests("Çok fazla basım bildirimi gönderildi; biraz sonra tekrar deneyin.", {
      code: "PRINT_JOB_RATE_LIMIT",
    });
  }
  live.push(now);
  recentReports.set(userId, live);
  if (recentReports.size > 5000) recentReports.clear();
}

/** Bekçi düzeneği: hız sınırı sayaçlarını sıfırlar. */
export function resetPrintJobRateForTest(): void {
  recentReports.clear();
}

const qs = (v: unknown): string | string[] | undefined =>
  typeof v === "string" || Array.isArray(v) ? (v as string | string[]) : undefined;

function readQuery(q: Request["query"]): PrintJobQuery {
  const one = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  return {
    userId: qs(q.userId),
    peripheralDeviceId: qs(q.peripheralDeviceId),
    printerName: qs(q.printerName),
    deviceRefId: qs(q.deviceRefId),
    stationId: qs(q.stationId),
    subjectKind: qs(q.subjectKind),
    status: qs(q.status),
    source: qs(q.source),
    outputKind: qs(q.outputKind),
    subjectId: one(q.subjectId),
    gunBas: one(q.gunBas),
    gunBit: one(q.gunBit),
  };
}

export class PrintJobController {
  /** POST /api/print-jobs — istemcinin bildirdiği basım (hata · iptal · PDF · belge). */
  report = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const size = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
      if (size > PRINT_JOB_BODY_MAX_BYTES) {
        throw AppError.badRequest("Basım bildirimi çok büyük (en çok 8 KB)", { code: "PRINT_JOB_BODY_TOO_LARGE", size });
      }
      const body = printJobReportSchema.parse(req.body);
      assertReportRate(req.user!.userId, Date.now());
      const ctx = await resolvePrintJobContext(req);
      const result = await reportPrintJob(ctx, body);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  /** GET /api/print-jobs — cursor'lı liste; `?ozet=1` özet şeridini de döndürür (aynı where). */
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const where = buildPrintJobWhere(readQuery(req.query));
      const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) || undefined : undefined;
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const page = await listPrintJobs(where, { cursor, limit });
      const wantSummary = req.query.ozet === "1" || req.query.ozet === "true";
      res.json(wantSummary ? { ...page, ozet: await summarizePrintJobs(where) } : page);
    } catch (e) {
      next(e);
    }
  };

  /** GET /api/print-jobs/:id */
  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getPrintJob(idSchema.parse(req.params.id)));
    } catch (e) {
      next(e);
    }
  };
}
