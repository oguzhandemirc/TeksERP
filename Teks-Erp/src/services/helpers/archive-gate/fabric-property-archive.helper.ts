// Kumaş özelliği arşiv kapısı — URUN-YASAM-DONGUSU.md §6 (bugün pasife almada hiç sayım yoktu).
import type { ArchiveSpec } from "../master-data-archive.helper";
import { LIVE_ROLL, OPEN_WORK_ORDER, openDemandLineWhere } from "../live-ref-where.helper";
import { ACTIVE_ROLL_PROPERTY, ACTIVE_TARGET_PROPERTY } from "../property-revoke.helper";
import { plannedPropertyStep } from "./route-plan-refs.helper";

const NOT_ARCHIVED_ITEM = { lifecycleStatus: { not: "ARCHIVED" as const } };

export const FABRIC_PROPERTY_ARCHIVE: ArchiveSpec = {
  entity: "fabricProperty",
  noun: "özelliği",
  table: "fabric_properties",
  auditTable: "FABRIC_PROPERTY",
  live: [
    {
      kind: "ROLL",
      label: "Canlı topun özelliği",
      count: (db, id) => db.rollProperty.count({ where: { propertyId: id, ...ACTIVE_ROLL_PROPERTY, roll: LIVE_ROLL } }),
      list: async (db, id, take) =>
        (await db.rollProperty.findMany({ where: { propertyId: id, ...ACTIVE_ROLL_PROPERTY, roll: LIVE_ROLL }, take, select: { id: true, roll: { select: { barcode: true, status: true } } } }))
          .map((p) => ({ id: p.id, title: p.roll.barcode ?? p.id, detail: p.roll.status })),
    },
    {
      kind: "WORK_ORDER",
      label: "Açık iş emrinin hedef özelliği",
      count: (db, id) => db.workOrderTargetProperty.count({ where: { propertyId: id, ...ACTIVE_TARGET_PROPERTY, workOrder: OPEN_WORK_ORDER } }),
      list: async (db, id, take) =>
        (await db.workOrderTargetProperty.findMany({ where: { propertyId: id, ...ACTIVE_TARGET_PROPERTY, workOrder: OPEN_WORK_ORDER }, take, select: { id: true, workOrder: { select: { workOrderNumber: true, status: true } } } }))
          .map((t) => ({ id: t.id, title: t.workOrder.workOrderNumber, detail: t.workOrder.status })),
    },
    {
      kind: "ORDER_LINE",
      label: "Açık sipariş kaleminin istenen özelliği",
      count: (db, id) => db.orderLineRequiredProperty.count({ where: { propertyId: id, orderLine: openDemandLineWhere(db) } }),
      list: async (db, id, take) =>
        (await db.orderLineRequiredProperty.findMany({ where: { propertyId: id, orderLine: openDemandLineWhere(db) }, take, select: { id: true, orderLine: { select: { order: { select: { orderNumber: true } }, item: { select: { name: true } } } } } }))
          .map((r) => ({ id: r.id, title: r.orderLine.order.orderNumber, detail: r.orderLine.item.name })),
    },
    plannedPropertyStep,
  ],
  config: [
    {
      kind: "ITEM_ALLOWED",
      label: "Ürünün izinli özelliği",
      count: (db, id) => db.itemAllowedProperty.count({ where: { propertyId: id, item: NOT_ARCHIVED_ITEM } }),
      list: async (db, id, take) =>
        (await db.itemAllowedProperty.findMany({ where: { propertyId: id, item: NOT_ARCHIVED_ITEM }, take, select: { id: true, item: { select: { code: true, name: true } } } }))
          .map((a) => ({ id: a.id, title: a.item.name, detail: a.item.code })),
    },
    {
      kind: "RECIPE",
      label: "Aktif reçete",
      count: (db, id) => db.productRecipeProperty.count({ where: { propertyId: id, recipe: { isActive: true } } }),
      list: async (db, id, take) =>
        (await db.productRecipeProperty.findMany({ where: { propertyId: id, recipe: { isActive: true } }, take, select: { id: true, recipe: { select: { code: true, name: true } } } }))
          .map((r) => ({ id: r.id, title: r.recipe.name, detail: r.recipe.code })),
    },
  ],
};
