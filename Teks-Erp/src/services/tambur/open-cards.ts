// =============================================================================
// Tambur Service / open-cards
// =============================================================================
// Açık top bekleyen refakat kartları (listOpenCards) — rotasız satırlar yalnız istemci isterse.
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================

import { stationWorkSearchWhere } from "../helpers/workorder-doc-search.helper";
import { scanRoutedOpenCards, type ScanRoutedOpenCard } from "../helpers/scan-route-open-cards.helper";
import { assertTamburStation, stationScreenStationWhere, tamburOpenStepWhere } from "../helpers/station-open-step.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
} from "@prisma/client";
import { uyari } from "../../lib/logger";

/** `listOpenCards` adım satırı (rotasız satırlar `ScanRoutedOpenCard`, yalnız istemci isterse). */
export type TamburOpenCard = {
  cardId: string;
  cardNumber: string;
  cardBarcode: string;
  workOrderId: string;
  batchNumber: string;
  stepId: string;
  stationName: string;
  stationCode: string;
  openRollCount: number;
  totalCurrentQty: number;
  /** WO.targetItem/targetColor — Kanban kartında kumaş + renk göstermek için. */
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  /** Tambur'a giriş tarihi — en eski açık RollMovement.enteredAt. Liste
   *  ekranında operatöre "ne kadar zamandır bekliyor" göstergesi için. */
  oldestEnteredAt: Date | null;
};

export async function listOpenCards(stationId: string | null = null, q: string | null = null, scan: { sessionStationId: string | null } | null = null): Promise<ApiResponse<Array<TamburOpenCard | ScanRoutedOpenCard>>> {
    // İster 2.8: istasyon verilirse yalnız o tamburun adımları (getPendingRolls ile aynı kapı).
    if (stationId) await assertTamburStation(stationId);
    const searchWhere = q ? stationWorkSearchWhere(q) : null;
    const steps = await prisma.workOrderStep.findMany({
      where: {
        // Açık kart = burada bekleyen iş: tek kaynak `tamburOpenStepWhere` (istasyonda belge okutma da okur).
        ...tamburOpenStepWhere(stationId),
        // K17: fiş/evrak/parti/İE no araması sunucuda (boş q = bugünkü liste).
        ...(searchWhere ? { workOrder: searchWhere } : {}),
      },
      select: {
        id: true,
        workOrderId: true,
        station: { select: { name: true, code: true } },
        workOrder: {
          select: {
            workOrderNumber: true,
            targetItem: { select: { name: true } },
            targetColor: { select: { name: true, hex: true } },
            // Kart iş emri başına — WO'nun aktif kartı Kanban'da gösterilir.
            travelerCards: {
              where: { status: "ACTIVE" },
              select: { id: true, cardNumber: true, barcode: true },
              take: 1,
            },
          },
        },
        currentRolls: {
          select: { currentQty: true },
        },
        movements: {
          where: { ...ACTIVE_MOVEMENT, exitedAt: null },
          select: { enteredAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      // Emniyet tavanı (kursun-qc.listOpenCards/listQueue ile parite): tablet Tambur
      // panosu bu ucu 5sn'de bir yokluyor; take yokken patolojik durumda tüm açık
      // adımları + nested payload çekerdi. Gerçekte bu kadar eş zamanlı açık Tambur
      // adımı görülmez → emniyet ağı; dolarsa sessiz kalma.
      take: 500,
    });
    if (steps.length === 500) {
      uyari("tambur", "listOpenCards: 500 açık-adım tavanına ulaşıldı — liste kırpılmış olabilir.");
    }

    const data = steps
      .map((s) => {
        // İş emrinin aktif kartı (kart WO başına).
        const card = s.workOrder.travelerCards[0];
        if (!card) return null;
        const oldest = s.movements.reduce<Date | null>((acc, m) => {
          if (acc === null) return m.enteredAt;
          return m.enteredAt < acc ? m.enteredAt : acc;
        }, null);
        return {
          cardId: card.id,
          cardNumber: card.cardNumber,
          cardBarcode: card.barcode,
          workOrderId: s.workOrderId,
          batchNumber: s.workOrder.workOrderNumber,
          stepId: s.id,
          stationName: s.station.name,
          stationCode: s.station.code,
          openRollCount: s.currentRolls.length,
          // Decimal toplam: Number toplamı kayan nokta artığı bırakıyordu (3934.9999999999995).
          totalCurrentQty: s.currentRolls.reduce((sum, r) => sum.plus(r.currentQty), new Prisma.Decimal(0)).toNumber(),
          itemName: s.workOrder.targetItem?.name ?? null,
          colorName: s.workOrder.targetColor?.name ?? null,
          colorHex: s.workOrder.targetColor?.hex ?? null,
          oldestEnteredAt: oldest,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // K29 S15b: yalnız istemci isterse (`scan` dolu) — oturum tamburunda eklenebilecek rotasız İE; eski APK görmez.
    if (!scan) return { success: true, data };
    const scanRows = await scanRoutedOpenCards({ stationId: scan.sessionStationId, stationWhere: stationScreenStationWhere("TAMBUR"), searchWhere, excludeWorkOrderIds: data.map((d) => d.workOrderId) });
    return { success: true, data: [...data, ...scanRows] };
  }
