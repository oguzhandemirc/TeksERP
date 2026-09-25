// Müşteri (cari kart) arşiv kapısı — URUN-YASAM-DONGUSU.md §6. Eski "açık sipariş" kapısı
// (M-26) ve cari bakiye kapısı buraya katlandı; PATCH isActive:false da aynı kapıdan geçer.
import { PackingGroupStatus, ShipmentStatus } from "@prisma/client";
import type { ArchiveSpec, Db, RefKind } from "../master-data-archive.helper";
import { LIVE_ROLL, LIVE_WARP_BEAM, OPEN_ORDER, OPEN_PURCHASE_ORDER } from "../live-ref-where.helper";

function rollRef(kind: string, label: string, col: "ownerCustomerId" | "labelCustomerId"): RefKind {
  return {
    kind,
    label,
    count: (db: Db, id: string) => db.roll.count({ where: { [col]: id, ...LIVE_ROLL } }),
    list: async (db: Db, id: string, take: number) =>
      (await db.roll.findMany({ where: { [col]: id, ...LIVE_ROLL }, take, orderBy: { barcode: "asc" }, select: { id: true, barcode: true, status: true } }))
        .map((r) => ({ id: r.id, title: r.barcode ?? r.id, detail: r.status })),
  };
}

export const CUSTOMER_ARCHIVE: ArchiveSpec = {
  entity: "customer",
  noun: "cari kartı",
  table: "customers",
  auditTable: "CUSTOMER",
  live: [
    {
      kind: "ORDER",
      label: "Açık sipariş",
      count: (db, id) => db.order.count({ where: { customerId: id, ...OPEN_ORDER } }),
      list: async (db, id, take) =>
        (await db.order.findMany({ where: { customerId: id, ...OPEN_ORDER }, take, orderBy: { createdAt: "asc" }, select: { id: true, orderNumber: true, status: true } }))
          .map((o) => ({ id: o.id, title: o.orderNumber, detail: o.status })),
    },
    {
      kind: "SHIPMENT",
      label: "Planlı sevkiyat",
      count: (db, id) => db.shipment.count({ where: { customerId: id, status: ShipmentStatus.PLANNED } }),
      list: async (db, id, take) =>
        (await db.shipment.findMany({ where: { customerId: id, status: ShipmentStatus.PLANNED }, take, select: { id: true, shipmentNo: true } }))
          .map((s) => ({ id: s.id, title: s.shipmentNo, detail: "PLANNED" })),
    },
    {
      kind: "SACK",
      label: "Sevk edilmemiş dolu çuval",
      count: (db, id) => db.sack.count({ where: { customerId: id, shipmentId: null, rolls: { some: {} } } }),
      list: async (db, id, take) =>
        (await db.sack.findMany({ where: { customerId: id, shipmentId: null, rolls: { some: {} } }, take, select: { id: true, sackNo: true } }))
          .map((s) => ({ id: s.id, title: s.sackNo, detail: "" })),
    },
    {
      kind: "PACKING_GROUP",
      label: "Açık paketleme grubu",
      count: (db, id) => db.packingGroup.count({ where: { customerId: id, status: PackingGroupStatus.OPEN } }),
      list: async (db, id, take) =>
        (await db.packingGroup.findMany({ where: { customerId: id, status: PackingGroupStatus.OPEN }, take, select: { id: true, code: true, name: true } }))
          .map((g) => ({ id: g.id, title: g.code, detail: g.name })),
    },
    rollRef("OWNED_ROLL", "Emanet canlı top", "ownerCustomerId"),
    rollRef("LABEL_ROLL", "Müşteri etiketli canlı top", "labelCustomerId"),
    {
      kind: "OWNED_BEAM",
      label: "Emanet levent",
      count: (db, id) => db.warpBeam.count({ where: { ownerCustomerId: id, ...LIVE_WARP_BEAM } }),
      list: async (db, id, take) =>
        (await db.warpBeam.findMany({ where: { ownerCustomerId: id, ...LIVE_WARP_BEAM }, take, select: { id: true, beamNo: true, status: true } }))
          .map((b) => ({ id: b.id, title: b.beamNo, detail: b.status })),
    },
    {
      kind: "OWNED_LOT",
      label: "Emanet iplik lotu",
      count: (db, id) => db.yarnLot.count({ where: { ownerCustomerId: id, isActive: true } }),
      list: async (db, id, take) =>
        (await db.yarnLot.findMany({ where: { ownerCustomerId: id, isActive: true }, take, select: { id: true, lotNo: true, item: { select: { name: true } } } }))
          .map((l) => ({ id: l.id, title: l.lotNo, detail: l.item.name })),
    },
    {
      kind: "PURCHASE_ORDER",
      label: "Açık alış siparişi",
      count: (db, id) => db.purchaseOrder.count({ where: { supplierId: id, ...OPEN_PURCHASE_ORDER } }),
      list: async (db, id, take) =>
        (await db.purchaseOrder.findMany({ where: { supplierId: id, ...OPEN_PURCHASE_ORDER }, take, select: { id: true, orderNo: true, status: true } }))
          .map((p) => ({ id: p.id, title: p.orderNo, detail: p.status })),
    },
    {
      kind: "CARI_BALANCE",
      label: "Cari bakiye",
      count: (db, id) => db.cariBalance.count({ where: { cari: { customerId: id }, balance: { not: 0 } } }),
      list: async (db, id, take) =>
        (await db.cariBalance.findMany({ where: { cari: { customerId: id }, balance: { not: 0 } }, take, select: { cariId: true, currency: true, balance: true } }))
          .map((b) => ({ id: `${b.cariId}:${b.currency}`, title: b.currency, detail: b.balance.toString() })),
    },
  ],
  config: [
    {
      kind: "ROUTE",
      label: "Müşteri rotası",
      count: (db, id) => db.route.count({ where: { customerId: id, isActive: true } }),
      list: async (db, id, take) =>
        (await db.route.findMany({ where: { customerId: id, isActive: true }, take, select: { id: true, name: true, code: true } }))
          .map((r) => ({ id: r.id, title: r.name, detail: r.code ?? "" })),
    },
  ],
};
