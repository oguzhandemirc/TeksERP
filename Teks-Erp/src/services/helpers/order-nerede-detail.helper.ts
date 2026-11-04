// SİPARİŞ "NEREDE?" — YAN PANEL (sözleşme §3). Liste ile aynı yükleyici + saf türetme.
import { Prisma, RollStatus, StationType, StepStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { factoryDateTimeTr } from "../../constants/time";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";
import { whereRollsOfWorkOrders } from "./workorder-rolls.helper";
import { NEREDE_ACTIVE_WO, NEREDE_READY, comparePlaces, daysText, fmtQty } from "./order-nerede.helper";
import { loadNeredeContext, neredeOfRow, placesOf } from "./order-nerede-load.helper";

export async function loadOrderNeredeDetail(orderId: string, now: Date = new Date()): Promise<unknown> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      manualClosedById: true,
      deadline: true,
      lines: {
        select: {
          quantity: true,
          shippedQty: true,
          unit: true,
          cancelledAt: true,
          workOrderLinks: {
            where: ACTIVE_ORDER_LINK,
            select: {
              workOrder: {
                select: {
                  id: true,
                  workOrderNumber: true,
                  status: true,
                  targetQuantity: true,
                  targetItem: { select: { name: true, unit: true } },
                  targetColor: { select: { code: true, name: true } },
                  steps: {
                    orderBy: { stepSequence: "asc" },
                    select: { id: true, stepSequence: true, status: true, station: { select: { name: true, type: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) throw AppError.notFound("Sipariş bulunamadı.");

  const ctx = await loadNeredeContext([order]);
  const head = neredeOfRow(order, ctx, now);

  const woMap = new Map<string, (typeof order.lines)[number]["workOrderLinks"][number]["workOrder"]>();
  for (const l of order.lines) {
    for (const link of l.workOrderLinks) {
      if (NEREDE_ACTIVE_WO.includes(link.workOrder.status)) woMap.set(link.workOrder.id, link.workOrder);
    }
  }
  const woIds = [...woMap.keys()];

  // Son hareket: üyelerin (her durumdaki) durum damgası + iptal edilmemiş hareketleri — 2 sorgu.
  const lastByWo = new Map<string, Date>();
  if (woIds.length > 0) {
    const members = await prisma.roll.findMany({
      where: whereRollsOfWorkOrders(woIds),
      select: {
        id: true,
        statusChangedAt: true,
        producedInStep: { select: { workOrderId: true } },
        currentStep: { select: { workOrderId: true } },
        batch: { select: { workOrderId: true } },
      },
    });
    const mv = members.length
      ? await prisma.rollMovement.groupBy({
          by: ["rollId"],
          where: { ...ACTIVE_MOVEMENT, rollId: { in: members.map((m) => m.id) } },
          _max: { enteredAt: true, exitedAt: true },
        })
      : [];
    const mvByRoll = new Map(mv.map((x) => [x.rollId, x._max]));
    const bump = (wo: string, d: Date | null | undefined): void => {
      if (!d) return;
      const p = lastByWo.get(wo);
      if (!p || d > p) lastByWo.set(wo, d);
    };
    for (const r of members) {
      const ws = new Set([r.producedInStep?.workOrderId, r.currentStep?.workOrderId, r.batch?.workOrderId]);
      for (const w of ws) {
        if (!w || !woMap.has(w)) continue;
        bump(w, r.statusChangedAt);
        bump(w, mvByRoll.get(r.id)?.enteredAt);
        bump(w, mvByRoll.get(r.id)?.exitedAt);
      }
    }
  }

  const workOrders = [...woMap.values()]
    .sort((a, b) => a.workOrderNumber.localeCompare(b.workOrderNumber, "tr"))
    .map((wo) => {
      const rolls = ctx.rollsByWo.get(wo.id) ?? [];
      const steps = wo.steps.map((s) => {
        const here = rolls.filter((r) => r.stepId === s.id && !NEREDE_READY.includes(r.status));
        const qty = here.reduce((a, r) => a + r.qty, 0);
        const fason = placesOf(here.filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR), now)
          .sort(comparePlaces)
          .map((p) => {
            const rs = here.filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR && `FASON:${r.firmId ?? "?"}` === p.key);
            return {
              firmId: rs[0]?.firmId ?? "",
              firmName: p.name,
              rollCount: p.rollCount,
              qty: rs.reduce((a, r) => a + r.qty, 0),
              days: p.days ?? 0,
              text: `${p.name || "Firma bilinmiyor"} · ${p.rollCount} top · ${daysText(p.days ?? 0)}`,
            };
          });
        const isExternal = s.station.type === StationType.EXTERNAL;
        const state: "DONE" | "CURRENT" | "TODO" =
          here.length > 0 || s.status === StepStatus.ACTIVE
            ? "CURRENT"
            : s.status === StepStatus.COMPLETED || s.status === StepStatus.SKIPPED
              ? "DONE"
              : "TODO";
        let text = s.station.name;
        if (fason.length > 0) {
          text += " · " + fason.map((f) => `${f.firmName || "Firma bilinmiyor"}, ${f.rollCount} top, ${daysText(f.days)}`).join("; ");
        } else if (here.length > 0) {
          text += ` · ${here.length} top · ${fmtQty(qty)} m`;
        }
        return { id: s.id, sequence: s.stepSequence, name: s.station.name, isExternal, state, rollCount: here.length, qty, fason, text };
      });
      const ready = rolls.filter((r) => NEREDE_READY.includes(r.status));
      const readyQty = ready.reduce((a, r) => a + r.qty, 0);
      const last = lastByWo.get(wo.id) ?? null;
      return {
        id: wo.id,
        workOrderNumber: wo.workOrderNumber,
        status: wo.status,
        itemName: wo.targetItem?.name ?? null,
        colorName: wo.targetColor ? `${wo.targetColor.code} ${wo.targetColor.name}`.trim() : null,
        targetQuantity: wo.targetQuantity === null ? null : new Prisma.Decimal(wo.targetQuantity).toNumber(),
        unit: wo.targetItem?.unit ?? null,
        steps,
        ready: {
          rollCount: ready.length,
          qty: readyQty,
          text: ready.length > 0 ? `Sevke hazır · ${ready.length} top · ${fmtQty(readyQty)} m` : "",
        },
        lastMovementAt: last ? last.toISOString() : null,
        lastMovementText: last ? factoryDateTimeTr(last) : null,
      };
    });

  return { orderId: order.id, nerede: head.nerede, sevk: head.sevk, workOrders };
}
