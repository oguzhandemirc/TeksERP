// =============================================================================
// Order Service / where-detail
// =============================================================================
// Sipariş 'nerede' detayı (iş emri olguları + aşama türetimi).
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import {
  WO_ROLLUP_ACTIVE,
  deriveOrderWhere,
  factoryDaysSince,
  loadWorkOrderFacts,
  type WoFacts,
} from "../helpers/order-where.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";

export async function getOrderWhereDetail(orderId: string): Promise<ApiResponse<unknown>> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        deadline: true,
        lines: {
          select: {
            workOrderLinks: {
              where: ACTIVE_ORDER_LINK,
              select: {
                workOrder: {
                  select: {
                    id: true,
                    workOrderNumber: true,
                    status: true,
                    targetQuantity: true,
                    targetItem: { select: { name: true } },
                    targetColor: { select: { name: true } },
                    steps: {
                      where: { status: { not: "SKIPPED" } },
                      orderBy: { stepSequence: "asc" },
                      select: { id: true, stepSequence: true, status: true, station: { select: { id: true, name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    const wos = new Map<string, NonNullable<(typeof order.lines)[number]["workOrderLinks"][number]["workOrder"]>>();
    for (const l of order.lines) for (const k of l.workOrderLinks) if (k.workOrder) wos.set(k.workOrder.id, k.workOrder);
    const active = [...wos.values()].filter((w) => WO_ROLLUP_ACTIVE.includes(w.status));
    const facts = await loadWorkOrderFacts(active.map((w) => w.id));
    const now = new Date();
    const nerede = deriveOrderWhere({ status: order.status, deadline: order.deadline, workOrders: [...wos.values()] }, facts, now);
    const isEmirleri = active
      .sort((a, b) => a.workOrderNumber.localeCompare(b.workOrderNumber, "tr"))
      .map((w) => {
        const f = facts.get(w.id) as WoFacts;
        const liveByStep = new Map<string, { top: number; metre: number; fasonTop: number }>();
        for (const g of f.live) {
          const e = liveByStep.get(g.stepId) ?? { top: 0, metre: 0, fasonTop: 0 };
          e.top += g.count;
          e.metre += g.qty;
          if (g.status === "AT_SUBCONTRACTOR") e.fasonTop += g.count;
          liveByStep.set(g.stepId, e);
        }
        const liveSeqs = w.steps.filter((s) => liveByStep.has(s.id)).map((s) => s.stepSequence);
        const maxLive = liveSeqs.length ? Math.max(...liveSeqs) : null;
        const finished = maxLive === null && f.hazir.count + f.gitti.count > 0;
        return {
          id: w.id,
          no: w.workOrderNumber,
          durum: w.status,
          kumas: w.targetItem?.name ?? null,
          renk: w.targetColor?.name ?? null,
          hedefMetre: w.targetQuantity != null ? Number(w.targetQuantity) : null,
          adimlar: w.steps.map((s) => {
            const live = liveByStep.get(s.id);
            const asama = live
              ? "BURADA"
              : finished || s.status === "COMPLETED" || (maxLive !== null && s.stepSequence < maxLive)
                ? "GECTI"
                : "SIRADA";
            return {
              id: s.id,
              ad: s.station.name,
              asama,
              topSayisi: live?.top ?? 0,
              metre: live ? Math.round(live.metre * 10) / 10 : 0,
              fasonTop: live?.fasonTop ?? 0,
            };
          }),
          fason: f.fason.map((g) => ({
            firmaId: g.firmaId,
            firmaAd: g.firmaAd,
            topSayisi: g.count,
            metre: Math.round(g.qty * 10) / 10,
            gun: factoryDaysSince(g.enEski, now),
          })),
          hazir: { topSayisi: f.hazir.count, metre: Math.round(f.hazir.qty * 10) / 10 },
          gitti: { topSayisi: f.gitti.count, metre: Math.round(f.gitti.qty * 10) / 10 },
          sonHareket: f.sonHareket ? f.sonHareket.toISOString() : null,
        };
      });
    return { success: true, data: { orderId: order.id, nerede, isEmirleri } };
  }
