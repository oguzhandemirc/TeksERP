// =============================================================================
// FASON DOKUMA — TABLET BAĞLAMI (G2t): açık fason işler + dönmemiş leventli sevkler
// =============================================================================
// Tek uç, OPT-IN allowlist (`warp-beam-tablet.service` emsali): operatöre cari,
// depo, fiyat, iş emri kolonları İNMEZ — `map` ile yalnız adı geçen alanlar çıkar,
// `select` genişletilse de sızmaz (bekçi `test_subcontractor_weaving §8`).
// Modül kapısı ikinci hat serviste: route `requireDokumaEnabled` düşse de 403.
// =============================================================================
import { WeavingExecutionKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { readDokumaEnabled } from "./system-setting.service";
import { WEAVING_ORDER_OPEN_STATUSES } from "./weaving-order.service";

export interface FasonTabletBeam {
  id: string;
  beamNo: string;
  sentM: number;
}
export interface FasonTabletDispatch {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  beams: FasonTabletBeam[];
}
export interface FasonTabletOrder {
  id: string;
  weavingOrderNumber: string;
  status: string;
  item: { name: string };
  color: { name: string } | null;
  subcontractor: { name: string } | null;
  openDispatches: FasonTabletDispatch[];
}
export interface FasonTabletContext {
  weavingOrders: FasonTabletOrder[];
}

export async function getWeavingTabletContext(): Promise<ApiResponse<FasonTabletContext>> {
  if (!(await readDokumaEnabled())) {
    throw AppError.forbidden("Dokuma modülü bu kurulumda kapalı — fason dokuma kabulü yapılamaz.", {
      code: "MODULE_DISABLED",
      modul: "dokuma",
    });
  }
  const orders = await prisma.weavingOrder.findMany({
    where: { executionKind: WeavingExecutionKind.SUBCONTRACTED, status: { in: [...WEAVING_ORDER_OPEN_STATUSES] } },
    orderBy: [{ plannedStartDate: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      weavingOrderNumber: true,
      status: true,
      item: { select: { name: true } },
      color: { select: { name: true } },
      subcontractor: { select: { name: true } },
      subcontractorDispatches: {
        where: { cancelledAt: null },
        orderBy: { dispatchedAt: "asc" },
        select: {
          id: true,
          dispatchNo: true,
          dispatchedAt: true,
          items: {
            select: {
              warpBeam: { select: { id: true, beamNo: true } },
              warpBeamEvents: { where: { reversal: { is: null } }, select: { kind: true, lengthM: true } },
            },
          },
        },
      },
    },
  });
  // ALLOWLIST `map`: yeni bir `select` alanı buradan geçmeden cihaza inmez.
  const weavingOrders: FasonTabletOrder[] = orders.map((o) => ({
    id: o.id,
    weavingOrderNumber: o.weavingOrderNumber,
    status: o.status,
    item: { name: o.item.name },
    color: o.color ? { name: o.color.name } : null,
    subcontractor: o.subcontractor ? { name: o.subcontractor.name } : null,
    openDispatches: o.subcontractorDispatches
      .map((d) => ({
        dispatchId: d.id,
        dispatchNo: d.dispatchNo,
        dispatchedAt: d.dispatchedAt.toISOString(),
        // Yalnız dönmemiş leventler (RETURNED_IN olayı olmayan kalemler).
        beams: d.items
          .filter((it) => it.warpBeam && !it.warpBeamEvents.some((e) => e.kind === "RETURNED_IN"))
          .map((it) => ({
            id: it.warpBeam!.id,
            beamNo: it.warpBeam!.beamNo,
            sentM: Number(it.warpBeamEvents.find((e) => e.kind === "SHIP_OUT")?.lengthM ?? 0),
          })),
      }))
      .filter((d) => d.beams.length > 0),
  }));
  return { success: true, data: { weavingOrders } };
}
