// =============================================================================
// İADE KAPSAMI — SEVKİYAT ve SEVK PARTİSİ düzeyinde "iade alınabilir top" listesi
// =============================================================================
// İade her zaman TOP satırlarıyla yazılır ve `createReturn` TEK SEVKİYAT ister
// (test_return_bulk_group [10]). Bu helper daha geniş bir kapsamın (bir sevkiyatın
// tamamı · bir sevk partisinin sevk edilmiş çuvalları — birden çok sevkiyattan
// olabilir) toplarını SEVKİYAT BAŞINA gruplayıp döner; panel her grubu ayrı bir
// `createReturn` çağrısına (= ayrı iade belgesi) çevirir. Belge çıkış belgesine
// bağlıdır; iki çıkışı tek irsaliyede karıştırmayız (brüt kuralı belge bazında).
//
// Aday siparişler: `lookupSackForReturn` "TÜM toplara uyan" siparişi döner; burada
// seçim istemcide değiştiği için sipariş `rollIds` (uyan toplar) ile döner ve
// istemci "seçili topların hepsine uyan" kümesini kendisi süzer — sunucu `createReturn`
// içinde yine her top için doğrular (kapı orada).
// =============================================================================

import { ROLL_DISPLAY_ORDER } from "../../constants/roll-order";
import { OrderStatus, Prisma, RollStatus, ShipmentStatus } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { normalizeScanCode } from "../../utils/code-format";
import { readReturnGradingEnabled } from "../system-setting.service";
// Tek kaynak: spec eşleşmesi `return.service.specMatch` (kopya yok — ayrışan yüzey kuralı).
import { specMatch } from "../return.service";

const ROLL_SELECT = {
  id: true,
  barcode: true,
  currentQty: true,
  width: true,
  qualityGrade: true,
  itemId: true,
  colorId: true,
  item: { select: { id: true, code: true, name: true } },
  color: { select: { id: true, code: true, name: true } },
  qualityGradeRef: { select: { id: true, code: true, name: true, color: true } },
} as const;

const SHIPMENT_SELECT = {
  id: true,
  shipmentNo: true,
  status: true,
  dispatchedAt: true,
  customer: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, name: true } },
  orders: {
    select: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          deadline: true,
          lines: { select: { itemId: true, colorId: true, width: true } },
        },
      },
    },
  },
} as const;

const SACK_SELECT = {
  id: true,
  sackNo: true,
  packageNo: true,
  packingGroup: { select: { id: true, name: true } },
  rolls: { where: { status: RollStatus.SHIPPED }, orderBy: ROLL_DISPLAY_ORDER, select: ROLL_SELECT },
} as const;

type RollRow = Prisma.RollGetPayload<{ select: typeof ROLL_SELECT }>;
type ShipmentRow = Prisma.ShipmentGetPayload<{ select: typeof SHIPMENT_SELECT }>;
type SackRow = Prisma.SackGetPayload<{ select: typeof SACK_SELECT }>;

function toRoll(r: RollRow) {
  return {
    id: r.id, barcode: r.barcode, currentQty: r.currentQty, width: r.width,
    item: r.item, color: r.color, qualityGrade: r.qualityGrade, qualityGradeRef: r.qualityGradeRef,
  };
}

/** Sevkiyatın iptal edilmemiş siparişleri + her birine uyan top id'leri. */
function ordersWithMatches(sh: ShipmentRow, rolls: RollRow[]) {
  return sh.orders
    .map((so) => so.order)
    .filter((o) => o.status !== OrderStatus.CANCELLED)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      deadline: o.deadline,
      rollIds: rolls
        .filter((r) => o.lines.some((l) => specMatch(l, { itemId: r.itemId, colorId: r.colorId, width: r.width })))
        .map((r) => r.id),
    }));
}

function toGroup(sh: ShipmentRow, sacks: SackRow[]) {
  const withRolls = sacks.filter((s) => s.rolls.length > 0);
  const rolls = withRolls.flatMap((s) => s.rolls);
  return {
    shipment: { id: sh.id, shipmentNo: sh.shipmentNo, dispatchedAt: sh.dispatchedAt },
    customer: sh.customer,
    branch: sh.branch,
    sacks: withRolls.map((s) => ({
      id: s.id, sackNo: s.sackNo, packageNo: s.packageNo, packingGroupName: s.packingGroup?.name ?? null,
      rolls: s.rolls.map(toRoll),
    })),
    orders: ordersWithMatches(sh, rolls),
  };
}

/** Bir SEVKİYATIN tamamı — numara (SVK…) ya da id ile. */
export async function lookupShipmentForReturn(q: { shipmentNo?: string | null; shipmentId?: string | null }) {
  const no = q.shipmentNo ? normalizeScanCode(q.shipmentNo) : null;
  if (!no && !q.shipmentId) throw AppError.badRequest("Sevkiyat numarası ya da id gerekli");
  const sh = await prisma.shipment.findFirst({
    where: q.shipmentId ? { id: q.shipmentId } : { shipmentNo: no as string },
    select: { ...SHIPMENT_SELECT, sacks: { orderBy: { seq: "asc" }, select: SACK_SELECT } },
  });
  if (!sh) throw AppError.notFound(`Sevkiyat bulunamadı: ${q.shipmentId ?? no}`);
  if (sh.status !== ShipmentStatus.DISPATCHED) {
    throw AppError.badRequest("Bu sevkiyat henüz sevk edilmemiş (ya da iptal) — iade alınamaz.");
  }
  const group = toGroup(sh, sh.sacks);
  if (group.sacks.length === 0) {
    throw AppError.badRequest("Bu sevkiyatta iade alınabilecek top kalmamış (hepsi iade alınmış olabilir).");
  }
  return { success: true as const, data: { ...group, returnGradingEnabled: await readReturnGradingEnabled() } };
}

/**
 * Bir SEVK PARTİSİNİN sevk edilmiş çuvalları — SEVKİYAT BAŞINA gruplu (parti kısmi
 * sevkle birden çok sevkiyata yayılmış olabilir). Havuzdaki (sevk edilmemiş) çuvallar
 * iade konusu değildir, listelenmez.
 */
export async function lookupLotForReturn(packingGroupId: string) {
  const lot = await prisma.packingGroup.findUnique({
    where: { id: packingGroupId },
    select: {
      id: true, name: true,
      customer: { select: { id: true, code: true, name: true } },
      sacks: {
        where: { shipment: { status: ShipmentStatus.DISPATCHED } },
        orderBy: [{ shipmentId: "asc" }, { packageNo: "asc" }],
        select: { ...SACK_SELECT, shipment: { select: SHIPMENT_SELECT } },
      },
    },
  });
  if (!lot) throw AppError.notFound("Sevk partisi bulunamadı");
  const byShipment = new Map<string, { sh: ShipmentRow; sacks: SackRow[] }>();
  for (const s of lot.sacks) {
    const sh = s.shipment;
    if (!sh) continue;
    const e = byShipment.get(sh.id) ?? { sh, sacks: [] };
    e.sacks.push(s);
    byShipment.set(sh.id, e);
  }
  const groups = [...byShipment.values()].map((e) => toGroup(e.sh, e.sacks)).filter((g) => g.sacks.length > 0);
  if (groups.length === 0) {
    throw AppError.badRequest(`${lot.name}: iade alınabilecek sevk edilmiş top yok (partisiz/havuzdaki çuvallar iade konusu değildir).`);
  }
  return {
    success: true as const,
    data: {
      lot: { id: lot.id, name: lot.name },
      customer: lot.customer,
      groups,
      returnGradingEnabled: await readReturnGradingEnabled(),
    },
  };
}
