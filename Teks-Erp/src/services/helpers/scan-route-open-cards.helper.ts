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

/**
 * Rotasız satır kapısı (TEK): oturum istasyonu okutmayla rotaya açık VE listenin istasyon türünden (Kurşun/KK akışı ya da
 * Tambur) — değilse null (liste rotasız satır göstermez, belge okutması "burada başlatılabilir" demez).
 */
async function scanRouteListStation(stationId: string | null, stationWhere: Prisma.StationWhereInput): Promise<{ name: string; code: string } | null> {
  if (!stationId || !(await scanRouteEnabledFor(stationId))) return null;
  return prisma.station.findFirst({ where: { AND: [{ id: stationId }, stationWhere] }, select: { name: true, code: true } });
}

/**
 * İstasyonda belge okutması: verilen İE'lerden hangisi bu listede "Sahada belirlenecek" satırı olurdu (okutunca adım
 * buraya eklenir) — `scanRoutedOpenCards` ile aynı kapı + aynı where.
 */
export async function scanRouteStartableWorkOrderIds(args: {
  stationId: string | null;
  stationWhere: Prisma.StationWhereInput;
  workOrderIds: readonly string[];
}): Promise<Set<string>> {
  if (!args.stationId || args.workOrderIds.length === 0 || !(await scanRouteListStation(args.stationId, args.stationWhere))) return new Set();
  const rows = await prisma.workOrder.findMany({
    where: { AND: [scanRoutedOpenWorkOrderWhere(args.stationId), { id: { in: [...args.workOrderIds] } }] },
    select: { id: true, travelerCards: { where: { status: TravelerCardStatus.ACTIVE }, select: { id: true }, take: 1 } },
  });
  return new Set(rows.filter((r) => r.travelerCards.length > 0).map((r) => r.id));
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
  const station = await scanRouteListStation(stationId, args.stationWhere);
  if (!stationId || !station) return [];
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
