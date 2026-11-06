// =============================================================================
// İSTASYON BELGE OKUTMA DOĞRULAMA İZİ — TELEMETRİ (2026-11-06)
// =============================================================================
// Her fotoğraf okutmasında puan · karar · tabletin ne açtığı (panel "son okutmalar": eşiği veriyle ayarlamak için).
// DEFTER DEĞİL: hiçbir karar/sayı buradan türetilmez; yazım best-effort (okutmayı asla düşürmez); 180 günden eski
// satır yazım anında budanır. Yazan · okuyan · budayan TEK dosya (defter-beyan TELEMETRI `silen`).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { uyari } from "../lib/logger";
import type { VerifyComponent } from "./helpers/station-scan-score.helper";

export const SCAN_CHECK_RETENTION_DAYS = 180;
/** SAME_PHOTO: bayt-eşit fotoğraf belgeye zaten bağlı (kimlik; puanlanmaz). */
export type ScanCheckDecision = "VERIFIED" | "UNSURE" | "NONE" | "OFF" | "SAME_PHOTO";
export type ScanOpenedHow = "AUTO" | "CHOSEN" | "CONFIRMED";

export interface ScanCheckInput {
  screen: string | null;
  source: string;
  readDocNo: string | null;
  readBatchNo: string | null;
  threshold: number;
  bestScore: number | null;
  candidateCount: number;
  verifiedCount: number;
  decision: ScanCheckDecision;
  components: VerifyComponent[] | null;
  bestWorkOrderNumber: string | null;
}

const cut = (v: string | null, n: number): string | null => (v ? v.slice(0, n) : null);

/** Okutma izini yazar; hata okutmayı düşürmez (null döner, uyarı loglanır). */
export async function recordStationScanCheck(c: ScanCheckInput): Promise<string | null> {
  try {
    const cutoff = new Date(Date.now() - SCAN_CHECK_RETENTION_DAYS * 86_400_000);
    await prisma.stationScanCheck.deleteMany({ where: { createdAt: { lt: cutoff } } });
    const row = await prisma.stationScanCheck.create({
      data: {
        screen: cut(c.screen, 16), source: c.source.slice(0, 16), readDocNo: cut(c.readDocNo, 64), readBatchNo: cut(c.readBatchNo, 64),
        threshold: c.threshold, bestScore: c.bestScore, candidateCount: Math.min(c.candidateCount, 32_000), verifiedCount: Math.min(c.verifiedCount, 32_000),
        decision: c.decision, components: c.components ? (c.components as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        bestWorkOrderNumber: cut(c.bestWorkOrderNumber, 64),
      },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    uyari("istasyon-okutma", `Doğrulama izi yazılamadı: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Tablet ne açtı: tek sefer (atomik claim `openedAt IS NULL`); ikinci bildirim 409. */
export async function markStationScanOpened(id: string, workOrderNumber: string, how: ScanOpenedHow): Promise<{ id: string }> {
  const r = await prisma.stationScanCheck.updateMany({
    where: { id, openedAt: null },
    data: { openedWorkOrderNumber: workOrderNumber.slice(0, 64), openedHow: how, openedAt: new Date() },
  });
  if (r.count === 0) throw AppError.conflict("Bu okutmanın sonucu zaten bildirildi ya da kayıt yok.", { code: "STATION_SCAN_CHECK_CLOSED" });
  return { id };
}

/** Panel listesi: en yeni okutmalar (eşik ayarı için). */
export function listStationScanChecks(take: number) {
  return prisma.stationScanCheck.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take,
    select: {
      id: true, createdAt: true, screen: true, source: true, readDocNo: true, readBatchNo: true, threshold: true, bestScore: true,
      candidateCount: true, verifiedCount: true, decision: true, components: true, bestWorkOrderNumber: true,
      openedWorkOrderNumber: true, openedHow: true, openedAt: true,
    },
  });
}
