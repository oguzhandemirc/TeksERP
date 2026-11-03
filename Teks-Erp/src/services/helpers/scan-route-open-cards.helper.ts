// =============================================================================
// TeksERP — OKUTMAYLA ROTA: istasyon açık iş listesinde ROTASIZ İE satırları (K29 S15b, 2026-11-03)
// =============================================================================
// Kurşun/KK (`kursun-qc.listOpenCards`) ve Tambur (`tambur.listOpenCards`) bu istasyonda ADIMI OLMAYAN açık rotasız
// (`scanRouted`) iş emirlerini "Sahada belirlenecek" satırı olarak YALNIZ istemci `includeScanRouted=1` isterse ekler:
// satırın `stepId`'si null'dır, eski APK bu sözleşmeyi bilmez. Seçilen satır tabletin bugünkü kart çözümüne gider →
// `by-card` 400 SCAN_ROUTE_AVAILABLE → `POST /api/scan-route` (adım ekleme yolu TEK). Kapı `scanRouteEnabledFor`.
// =============================================================================
import { Prisma, RollStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { scanRouteEnabledFor } from "./okutmayla-rota.helper";

/** `?includeScanRouted=1` — yeni tablet JS gönderir; yoksa liste bayt-aynı. */
export const scanRoutedQuerySchema = z.object({
  includeScanRouted: z.enum(["1", "true"]).optional(),
});

export const SCAN_ROUTED_CARD_LABEL = "Sahada belirlenecek";
const SCAN_ROUTED_CARDS_CAP = 200;

/**
 * TEK where: bu istasyonda okutulunca adım eklenebilecek açık rotasız İE — açık (PLANNED/IN_PROGRESS), aktif refakat
 * kartı var, bu istasyonda HİÇ adımı yok (adımı olan İE bugünkü listede ya da yeniden açma yolunda), üretimde topu var.
 */
export function scanRoutedOpenWorkOrderWhere(stationId: string): Prisma.WorkOrderWhereInput {
  return {
    scanRouted: true,
    status: { in: [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS] },
    travelerCards: { some: { status: TravelerCardStatus.ACTIVE } },
    steps: { none: { stationId } },
    batches: { some: { rolls: { some: { status: RollStatus.IN_PRODUCTION } } } },
  };
}

export interface ScanRoutedOpenCard {
  cardId: string;
  cardNumber: string;
  cardBarcode: string;
  workOrderId: string;
  batchNumber: string;
  /** Rotasız İE'nin bu istasyonda adımı yok — okutunca eklenir. */
  stepId: null;
  /** Okutan oturum istasyonu (adım buraya eklenecek). */
  stationName: string;
  stationCode: string;
  openRollCount: number;
  scanRouteAdd: true;
  scanRouteLabel: string;
}

/**
 * Oturum istasyonunda listelenecek rotasız satırlar. `stationWhere`: listenin istasyon türü (Kurşun/KK akışı ya da
 * Tambur) — oturum istasyonu o türden değilse boş. `excludeWorkOrderIds`: bugünkü listede zaten olan İE (tekrar yok).
 */
export async function scanRoutedOpenCards(args: {
  stationId: string | null;
  stationWhere: Prisma.StationWhereInput;
  searchWhere: Prisma.WorkOrderWhereInput | null;
  excludeWorkOrderIds: readonly string[];
}): Promise<ScanRoutedOpenCard[]> {
  const { stationId } = args;
  if (!stationId || !(await scanRouteEnabledFor(stationId))) return [];
  const station = await prisma.station.findFirst({ where: { AND: [{ id: stationId }, args.stationWhere] }, select: { name: true, code: true } });
  if (!station) return [];
  const exclude = [...new Set(args.excludeWorkOrderIds)];
  const rows = await prisma.workOrder.findMany({
    where: {
      AND: [
        scanRoutedOpenWorkOrderWhere(stationId),
        ...(exclude.length > 0 ? [{ id: { notIn: exclude } }] : []),
        ...(args.searchWhere ? [args.searchWhere] : []),
      ],
    },
    select: {
      id: true,
      workOrderNumber: true,
      travelerCards: { where: { status: TravelerCardStatus.ACTIVE }, select: { id: true, cardNumber: true, barcode: true }, take: 1 },
      batches: {
        select: {
          batchNumber: true,
          _count: { select: { rolls: { where: { status: RollStatus.IN_PRODUCTION } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
    take: SCAN_ROUTED_CARDS_CAP,
  });
  return rows.flatMap((wo) => {
    const card = wo.travelerCards[0];
    if (!card) return [];
    const live = wo.batches.filter((b) => b._count.rolls > 0);
    return [{
      cardId: card.id,
      cardNumber: card.cardNumber,
      cardBarcode: card.barcode,
      workOrderId: wo.id,
      batchNumber: live[0]?.batchNumber ?? wo.workOrderNumber,
      stepId: null,
      stationName: station.name,
      stationCode: station.code,
      openRollCount: live.reduce((n, b) => n + b._count.rolls, 0),
      scanRouteAdd: true as const,
      scanRouteLabel: SCAN_ROUTED_CARD_LABEL,
    }];
  });
}
