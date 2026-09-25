// Renk arşiv kapısı — URUN-YASAM-DONGUSU.md §6. Canlı: mal, açık belge, aktif rota planı.
import type { ArchiveSpec } from "../master-data-archive.helper";
import { LIVE_ROLL, OPEN_MACHINE_RUN, OPEN_WEAVING_ORDER, OPEN_WORK_ORDER, openDemandLineWhere } from "../live-ref-where.helper";
import { plannedColorStep } from "./route-plan-refs.helper";

const NOT_ARCHIVED_ITEM = { lifecycleStatus: { not: "ARCHIVED" as const } };

export const COLOR_ARCHIVE: ArchiveSpec = {
  entity: "color",
  noun: "rengi",
  table: "colors",
  auditTable: "COLOR",
  live: [
    {
      kind: "ROLL",
      label: "Canlı top",
      count: (db, id) => db.roll.count({ where: { colorId: id, ...LIVE_ROLL } }),
      list: async (db, id, take) =>
        (await db.roll.findMany({ where: { colorId: id, ...LIVE_ROLL }, take, orderBy: { barcode: "asc" }, select: { id: true, barcode: true, status: true } }))
          .map((r) => ({ id: r.id, title: r.barcode ?? r.id, detail: r.status })),
    },
    {
      kind: "ORDER_LINE",
      label: "Açık sipariş kalemi",
      count: (db, id) => db.orderLine.count({ where: { colorId: id, ...openDemandLineWhere(db) } }),
      list: async (db, id, take) =>
        (await db.orderLine.findMany({ where: { colorId: id, ...openDemandLineWhere(db) }, take, select: { id: true, order: { select: { orderNumber: true } }, item: { select: { name: true } } } }))
          .map((l) => ({ id: l.id, title: l.order.orderNumber, detail: l.item.name })),
    },
    {
      kind: "WORK_ORDER",
      label: "Açık iş emri",
      count: (db, id) => db.workOrder.count({ where: { targetColorId: id, ...OPEN_WORK_ORDER } }),
      list: async (db, id, take) =>
        (await db.workOrder.findMany({ where: { targetColorId: id, ...OPEN_WORK_ORDER }, take, select: { id: true, workOrderNumber: true, status: true } }))
          .map((w) => ({ id: w.id, title: w.workOrderNumber, detail: w.status })),
    },
    {
      kind: "WEAVING_ORDER",
      label: "Açık dokuma işi",
      count: (db, id) => db.weavingOrder.count({ where: { colorId: id, ...OPEN_WEAVING_ORDER } }),
      list: async (db, id, take) =>
        (await db.weavingOrder.findMany({ where: { colorId: id, ...OPEN_WEAVING_ORDER }, take, select: { id: true, weavingOrderNumber: true, status: true } }))
          .map((w) => ({ id: w.id, title: w.weavingOrderNumber, detail: w.status })),
    },
    {
      kind: "MACHINE_RUN",
      label: "Açık tezgah koşumu",
      count: (db, id) => db.machineRun.count({ where: { colorId: id, ...OPEN_MACHINE_RUN } }),
      list: async (db, id, take) =>
        (await db.machineRun.findMany({ where: { colorId: id, ...OPEN_MACHINE_RUN }, take, select: { id: true, startedAt: true, machine: { select: { name: true } } } }))
          .map((m) => ({ id: m.id, title: m.machine.name, detail: m.startedAt.toISOString() })),
    },
    plannedColorStep,
  ],
  config: [
    {
      kind: "ITEM_ALLOWED",
      label: "Ürünün izinli rengi",
      count: (db, id) => db.itemAllowedColor.count({ where: { colorId: id, item: NOT_ARCHIVED_ITEM } }),
      list: async (db, id, take) =>
        (await db.itemAllowedColor.findMany({ where: { colorId: id, item: NOT_ARCHIVED_ITEM }, take, select: { id: true, item: { select: { code: true, name: true } } } }))
          .map((a) => ({ id: a.id, title: a.item.name, detail: a.item.code })),
    },
    {
      kind: "RECIPE",
      label: "Aktif reçete",
      count: (db, id) => db.productRecipe.count({ where: { colorId: id, isActive: true } }),
      list: async (db, id, take) =>
        (await db.productRecipe.findMany({ where: { colorId: id, isActive: true }, take, select: { id: true, code: true, name: true } }))
          .map((r) => ({ id: r.id, title: r.name, detail: r.code })),
    },
  ],
};
