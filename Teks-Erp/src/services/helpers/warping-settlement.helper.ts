// =============================================================================
// FASON DEVERE — sipariş MUTABAKAT sayıları (tek helper: dönüş yanıtı, kabul listesi, kapanış önizlemesi aynı fonksiyon)
// =============================================================================
// metre : hedef (adet × boy) · gelen (Σ canlı WOUND) · fark · fark % · levent adedi plan ↔ gelen
// iplik : plan net/brüt · gönderilen (BRÜT) · iade · aktarım · sarılan (nominal Σ kırılım) · kendi tutmasından /
//         devirden dağıtılan · dağıtılamayan · fire · deverecide kalan (tutma)
// tartı : girildiyse Σ(brüt − dara) ↔ aynı leventlerin nominal Σ'ı — yalnız BİLGİ, hiçbir sayıyı değiştirmez.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import { sequentialTx } from "./tx-sequential-relations.helper";
import { loadWarpingYarnItems, sumByYarn } from "./warping-yarn-open.helper";
import { loadWarpingOrderDto } from "../warping-order/read";
import { isRejectedBeam } from "./warping-beam-rejection.helper";

type Db = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);
const pct = (part: Prisma.Decimal, whole: Prisma.Decimal) => (whole.isZero() ? null : part.div(whole).mul(100).toFixed(2));

export interface WarpingSettlementYarn {
  yarnItemId: string; code: string; name: string; letter: string;
  planNetKg: string; planGrossKg: string;
  dispatchedKg: string; returnedKg: string; transferInKg: string; transferOutKg: string;
  /** Bu siparişin canlı leventlerinin nominal ipliği (Σ kırılım). */
  woundKg: string;
  /** Sarılanın bu siparişin tuttuğu kalemlerden düşen kısmı. */
  fromOwnKg: string;
  /** Sarılanın başka (kapanmış) siparişin kalanından düşen kısmı — devirden kullanılan. */
  carryOverUsedKg: string;
  /** Deverecideki iplikten fazla nominal tüketim (dağıtılamadı). */
  unallocatedKg: string;
  /** Bu siparişin yazdığı net canlı fire (kapanış + iade penceresi; WASTE − WASTE_CANCEL). */
  wasteKg: string;
  /** Bu siparişin deverecide tuttuğu iplik. */
  atSubcontractorKg: string;
}

export interface WarpingSettlement {
  /** Gelen/fark/fire % reddedilen sarımı DÜŞER (C1); reddedilen ayrı `rejectedM`/`rejectedBeamCount`ta. */
  metre: { targetM: string; receivedM: string; diffM: string; diffPct: string | null; planBeamCount: number | null; planBeamCountOpen: boolean; receivedBeamCount: number; rejectedM: string; rejectedBeamCount: number };
  yarns: WarpingSettlementYarn[];
  weighing: { weighedBeamCount: number; weighedNetKg: string; nominalKg: string; diffKg: string; diffPct: string | null } | null;
}

export const LIVE_WOUND_SELECT = {
  id: true, lengthM: true, theoreticalKg: true, grossKg: true, tareKg: true, deliveryNoteNo: true, createdAt: true,
  reversal: { select: { id: true } },
  yarns: { select: { id: true, yarnItemId: true, theoreticalKg: true, allocations: { select: { kg: true, holderWarpingOrderId: true, dispatchItemId: true } } } },
} satisfies Prisma.WarpBeamEventSelect;

/** Siparişin leventleri + WOUND satırları (iptal edilenler `reversal` dolu döner; çağıran süzer). */
export async function loadOrderBeams(db: Db, warpingOrderId: string) {
  return sequentialTx(db).warpBeam.findMany({
    where: { warpingOrderId },
    select: {
      id: true, beamNo: true, status: true, physicalBeamNo: true, warpingReceiptKey: true, ownerCustomerId: true, reworkOfBeamId: true,
      warpingReceiveDoc: { select: { id: true, docNo: true } },
      events: { where: { kind: "WOUND" }, select: LIVE_WOUND_SELECT },
    },
    orderBy: { beamNo: "asc" },
  });
}

/** Tartının net kg'ı — dara yoksa bilinmez (null); brüt ≤ dara servis kapısında reddedilir. */
export function weighedNetKg(w: { grossKg: Prisma.Decimal | null; tareKg: Prisma.Decimal | null }): Prisma.Decimal | null {
  return w.grossKg !== null && w.tareKg !== null ? D(w.grossKg).minus(w.tareKg) : null;
}

export async function loadWarpingSettlement(db: Db, warpingOrderId: string): Promise<WarpingSettlement> {
  const order = await loadWarpingOrderDto(sequentialTx(db), warpingOrderId);
  const all = (await loadOrderBeams(db, warpingOrderId)).filter((b) => b.status !== WarpBeamStatus.CANCELLED);
  const beams = all.filter((b) => !isRejectedBeam(b));
  const rejected = all.filter(isRejectedBeam);
  const rejectedM = rejected.reduce((s, b) => s.plus(b.events.find((e) => !e.reversal)?.lengthM ?? 0), D(0));
  const sums = sumByYarn(await loadWarpingYarnItems(db, { warpingOrderId }));
  let receivedM = D(0);
  let wN = 0;
  let wNet = D(0);
  let wNom = D(0);
  const wound = new Map<string, { total: Prisma.Decimal; own: Prisma.Decimal; carry: Prisma.Decimal }>();
  for (const b of beams) {
    const ev = b.events.find((e) => !e.reversal);
    if (!ev) continue;
    receivedM = receivedM.plus(ev.lengthM ?? 0);
    const net = weighedNetKg(ev);
    if (net) { wN++; wNet = wNet.plus(net); wNom = wNom.plus(ev.theoreticalKg ?? 0); }
    for (const y of ev.yarns) {
      const cur = wound.get(y.yarnItemId) ?? { total: D(0), own: D(0), carry: D(0) };
      cur.total = cur.total.plus(y.theoreticalKg);
      for (const a of y.allocations) {
        if (a.holderWarpingOrderId === warpingOrderId) cur.own = cur.own.plus(a.kg);
        else cur.carry = cur.carry.plus(a.kg);
      }
      wound.set(y.yarnItemId, cur);
    }
  }
  const target = D(order.targetLengthM);
  const diff = receivedM.minus(target);
  return {
    metre: { targetM: kg(target), receivedM: kg(receivedM), diffM: kg(diff), diffPct: pct(diff, target), planBeamCount: order.beamCount, planBeamCountOpen: order.beamCountOpen, receivedBeamCount: beams.filter((b) => b.events.some((e) => !e.reversal)).length, rejectedM: kg(rejectedM), rejectedBeamCount: rejected.length },
    yarns: order.yarns.map((y) => {
      const s = sums.get(y.yarnItemId);
      const w = wound.get(y.yarnItemId) ?? { total: D(0), own: D(0), carry: D(0) };
      return {
        yarnItemId: y.yarnItemId, code: y.code, name: y.name, letter: y.letter, planNetKg: y.netKg, planGrossKg: y.grossKg,
        dispatchedKg: kg(s?.outKg ?? D(0)), returnedKg: kg(s?.returnedKg ?? D(0)), transferInKg: kg(s?.transferInKg ?? D(0)), transferOutKg: kg(s?.transferOutKg ?? D(0)),
        woundKg: kg(w.total), fromOwnKg: kg(w.own), carryOverUsedKg: kg(w.carry), unallocatedKg: kg(w.total.minus(w.own).minus(w.carry)),
        wasteKg: kg(s?.wasteKg ?? D(0)), atSubcontractorKg: kg(s?.openKg ?? D(0)),
      };
    }),
    weighing: wN === 0 ? null : { weighedBeamCount: wN, weighedNetKg: kg(wNet), nominalKg: kg(wNom), diffKg: kg(wNet.minus(wNom)), diffPct: pct(wNet.minus(wNom), wNom) },
  };
}
