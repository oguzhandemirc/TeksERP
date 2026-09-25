// Fasoncu (fason profili) arşiv kapısı — URUN-YASAM-DONGUSU.md §6 (bugün sayım yoktu).
import type { ArchiveSpec } from "../master-data-archive.helper";
import { LIVE_WARP_BEAM, OPEN_PURCHASE_ORDER, OPEN_STEP, OPEN_WEAVING_ORDER } from "../live-ref-where.helper";
import { OPEN_OUTSTANDING } from "../fason-open-dispatch.helper";
import { plannedSubcontractorStep } from "./route-plan-refs.helper";

const OPEN_KARTELA = { cancelledAt: null, receipts: { none: { cancelledAt: null } } };

export const SUBCONTRACTOR_ARCHIVE: ArchiveSpec = {
  entity: "subcontractor",
  noun: "fasoncusu",
  table: "subcontractors",
  auditTable: "SUBCONTRACTOR",
  live: [
    {
      kind: "DISPATCH",
      label: "Açık fason sevki",
      count: (db, id) => db.subcontractorDispatch.count({ where: { subcontractorId: id, ...OPEN_OUTSTANDING } }),
      list: async (db, id, take) =>
        (await db.subcontractorDispatch.findMany({ where: { subcontractorId: id, ...OPEN_OUTSTANDING }, take, select: { id: true, dispatchNo: true, dispatchedAt: true } }))
          .map((d) => ({ id: d.id, title: d.dispatchNo, detail: d.dispatchedAt.toISOString().slice(0, 10) })),
    },
    {
      kind: "KARTELA_DISPATCH",
      label: "Açık kartela sevki",
      count: (db, id) => db.kartelaDispatch.count({ where: { subcontractorId: id, ...OPEN_KARTELA } }),
      list: async (db, id, take) =>
        (await db.kartelaDispatch.findMany({ where: { subcontractorId: id, ...OPEN_KARTELA }, take, select: { id: true, dispatchNo: true, dispatchedAt: true } }))
          .map((d) => ({ id: d.id, title: d.dispatchNo, detail: d.dispatchedAt.toISOString().slice(0, 10) })),
    },
    {
      kind: "WARP_BEAM",
      label: "Fasondaki levent",
      count: (db, id) => db.warpBeam.count({ where: { subcontractorId: id, ...LIVE_WARP_BEAM } }),
      list: async (db, id, take) =>
        (await db.warpBeam.findMany({ where: { subcontractorId: id, ...LIVE_WARP_BEAM }, take, select: { id: true, beamNo: true, status: true } }))
          .map((b) => ({ id: b.id, title: b.beamNo, detail: b.status })),
    },
    {
      kind: "WEAVING_ORDER",
      label: "Açık dokuma işi",
      count: (db, id) => db.weavingOrder.count({ where: { subcontractorId: id, ...OPEN_WEAVING_ORDER } }),
      list: async (db, id, take) =>
        (await db.weavingOrder.findMany({ where: { subcontractorId: id, ...OPEN_WEAVING_ORDER }, take, select: { id: true, weavingOrderNumber: true, status: true } }))
          .map((w) => ({ id: w.id, title: w.weavingOrderNumber, detail: w.status })),
    },
    {
      kind: "PURCHASE_ORDER",
      label: "Açık alış siparişi",
      count: (db, id) => db.purchaseOrder.count({ where: { subcontractorId: id, ...OPEN_PURCHASE_ORDER } }),
      list: async (db, id, take) =>
        (await db.purchaseOrder.findMany({ where: { subcontractorId: id, ...OPEN_PURCHASE_ORDER }, take, select: { id: true, orderNo: true, status: true } }))
          .map((p) => ({ id: p.id, title: p.orderNo, detail: p.status })),
    },
    {
      kind: "PLANNED_STEP",
      label: "Açık iş emrinde planlı adım",
      count: (db, id) => db.workOrderStep.count({ where: { plannedSubcontractorId: id, ...OPEN_STEP } }),
      list: async (db, id, take) =>
        (await db.workOrderStep.findMany({ where: { plannedSubcontractorId: id, ...OPEN_STEP }, take, select: { id: true, stepSequence: true, workOrder: { select: { workOrderNumber: true } } } }))
          .map((s) => ({ id: s.id, title: s.workOrder.workOrderNumber, detail: `adım ${s.stepSequence}` })),
    },
    plannedSubcontractorStep,
  ],
  config: [],
};
