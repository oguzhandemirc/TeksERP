// =============================================================================
// SEVKİYATIN BRÜT TOP KÜMESİ — TEK KAYNAK (kârlılık K1 dilim 1)
// =============================================================================
// Sevk taslağının ürün satırları (`shipment-auto-draft`) ile kumaş satışı kârlılığının metre payı
// (`profitability-product`) AYNI kümeyi okur: canlı top (hayalet statüler hariç) + iptal edilmemiş iade
// (sevk anındaki metreyle). İade `Roll.shipmentId`yi NULL'lar; yalnız canlı küme okunursa sevk NET çıkar
// (sevk rakamı brüttür). Aynı sevkte hem canlı hem iade görünen top bir kez sayılır (iki sorgu arası iade).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { SACK_ABSENT_STATUSES } from "./sack-invariants.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export type ShipmentGrossRoll = {
  id: string;
  shipmentId: string;
  itemId: string;
  colorId: string | null;
  /** Canlı topta güncel metre; iade edilmiş topta iade anındaki (= sevk anındaki) metre. */
  currentQty: Prisma.Decimal;
  width: Prisma.Decimal | null;
  item: { name: string };
  color: { name: string } | null;
  ownerCustomerId: string | null;
  barcode: string | null;
  returned: boolean;
};

/** Sevklerin brüt top kümesi; sıra: her sevk için önce canlı, sonra iade edilmiş toplar (taslak gruplaması bu sırayı okur). */
export async function collectShipmentGrossRolls(shipmentIds: readonly string[], db: Db = prisma): Promise<ShipmentGrossRoll[]> {
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) return [];
  const live = await db.roll.findMany({
    where: { shipmentId: { in: ids }, status: { notIn: SACK_ABSENT_STATUSES } },
    select: {
      id: true, shipmentId: true, itemId: true, colorId: true, currentQty: true, width: true,
      item: { select: { name: true } }, color: { select: { name: true } }, ownerCustomerId: true, barcode: true,
    },
  });
  const returned = await db.rollReturn.findMany({
    where: { fromShipmentId: { in: ids }, cancelledAt: null },
    select: {
      rollId: true, fromShipmentId: true, itemId: true, colorId: true, qty: true, width: true,
      item: { select: { name: true } }, color: { select: { name: true } }, roll: { select: { barcode: true, ownerCustomerId: true } },
    },
  });
  const liveKeys = new Set(live.map((r) => `${r.shipmentId}|${r.id}`));
  const out: ShipmentGrossRoll[] = [];
  for (const sid of ids) {
    for (const r of live) if (r.shipmentId === sid) out.push({ ...r, shipmentId: sid, returned: false });
    for (const rr of returned) {
      if (rr.fromShipmentId !== sid || liveKeys.has(`${sid}|${rr.rollId}`)) continue;
      out.push({
        id: rr.rollId, shipmentId: sid, itemId: rr.itemId, colorId: rr.colorId, currentQty: rr.qty, width: rr.width,
        item: { name: rr.item?.name ?? "" }, color: rr.color ? { name: rr.color.name } : null,
        ownerCustomerId: rr.roll.ownerCustomerId, barcode: rr.roll.barcode, returned: true,
      });
    }
  }
  return out;
}
