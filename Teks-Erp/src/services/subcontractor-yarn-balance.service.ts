// =============================================================================
// FASONCUDAKİ İPLİK BAKİYESİ — türetilmiş okuyucu (`subcontractor-yarn.service`ten ayrıldı, dosya boyu)
// =============================================================================
// Bakiye = Σ(OUT − OUT_CANCEL − RETURN + RETURN_CANCEL) − sarılan (G1c WOUND + D5 devere dağıtımı);
// sanal depo YOK, satır yazılmaz. Defter ve yazıcı açıklaması `subcontractor-yarn.service.ts` başlığında.
// =============================================================================
import { Prisma, SubcontractorDispatchItemKind, YarnMovementKind } from "@prisma/client";
import prisma from "../lib/prisma";
import type { ApiResponse } from "../types/api.types";
import { LIVE_ALLOCATION } from "./helpers/warping-yarn-open.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface YarnAtSubcontractorRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotNo: string | null;
  outKg: number;
  returnedKg: number;
  /** G1c: bu kaleme bağlı (storno edilmemiş) WOUND olaylarının nominal kg toplamı — tahmin değil, beyanlı kaynak. */
  sarilanKg: number;
  /** `THEORETICAL` · `WEIGHED` · `KARMA` (iki kaynak) · null (sarım yok). */
  sarilanKaynak: "THEORETICAL" | "WEIGHED" | "KARMA" | null;
  /** = çıkış − dönüş − sarılan. */
  remainingKg: number;
}

type KgSourceMark = YarnAtSubcontractorRow["sarilanKaynak"];
function mergeKgSource(cur: KgSourceMark, next: "THEORETICAL" | "WEIGHED" | null): KgSourceMark {
  if (next === null) return cur;
  if (cur === null || cur === next) return next;
  return "KARMA";
}

const FASON_KINDS: YarnMovementKind[] = [YarnMovementKind.SUBCONTRACT_OUT, YarnMovementKind.SUBCONTRACT_OUT_CANCEL, YarnMovementKind.SUBCONTRACT_RETURN, YarnMovementKind.SUBCONTRACT_RETURN_CANCEL];

/** Bir fasoncudaki iplik — iptal edilmemiş sevklerin kalemleri, kalem × lot; sanal depo YOK, satır yazılmaz. */
export async function yarnAtSubcontractor(subcontractorId: string): Promise<ApiResponse<YarnAtSubcontractorRow[]>> {
  const rows = await prisma.yarnMovement.findMany({
    where: { kind: { in: FASON_KINDS }, dispatchItem: { dispatch: { subcontractorId, cancelledAt: null } } },
    select: { kind: true, qtyKg: true, itemId: true, item: { select: { code: true, name: true } }, dispatchItem: { select: { lotId: true, lot: { select: { lotNo: true } } } } },
  });
  // G1c: bu fasoncunun iplik kalemlerine bağlı, storno edilmemiş sarımlar (WOUND) — nominal kg, kaynağı beyanlı.
  const wounds = await prisma.warpBeamEvent.findMany({
    where: { kind: "WOUND", reversal: null, dispatchItem: { kind: SubcontractorDispatchItemKind.YARN, dispatch: { subcontractorId, cancelledAt: null } } },
    select: { theoreticalKg: true, kgSource: true, dispatchItem: { select: { yarnItemId: true, lotId: true } } },
  });
  type Acc = YarnAtSubcontractorRow & { out: Prisma.Decimal; ret: Prisma.Decimal; sar: Prisma.Decimal };
  const acc = new Map<string, Acc>();
  const rowOf = (itemId: string, lotId: string | null, item: { code: string; name: string }, lotNo: string | null): Acc => {
    const key = `${itemId}|${lotId ?? ""}`;
    const row = acc.get(key) ?? { itemId, itemCode: item.code, itemName: item.name, lotId, lotNo, outKg: 0, returnedKg: 0, sarilanKg: 0, sarilanKaynak: null, remainingKg: 0, out: D(0), ret: D(0), sar: D(0) };
    acc.set(key, row);
    return row;
  };
  for (const m of rows) {
    const row = rowOf(m.itemId, m.dispatchItem?.lotId ?? null, m.item, m.dispatchItem?.lot?.lotNo ?? null);
    if (m.kind === YarnMovementKind.SUBCONTRACT_OUT) row.out = row.out.plus(m.qtyKg);
    else if (m.kind === YarnMovementKind.SUBCONTRACT_OUT_CANCEL) row.out = row.out.minus(m.qtyKg);
    else if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN) row.ret = row.ret.plus(m.qtyKg);
    else row.ret = row.ret.minus(m.qtyKg);
  }
  for (const w of wounds) {
    const key = `${w.dispatchItem?.yarnItemId}|${w.dispatchItem?.lotId ?? ""}`;
    const row = acc.get(key);
    if (!row) continue; // kalemin OUT satırı yoksa (iptal edilmiş sevk) sarım da bakiyeye girmez
    row.sar = row.sar.plus(w.theoreticalKg ?? 0);
    row.sarilanKaynak = mergeKgSource(row.sarilanKaynak, w.kgSource);
  }
  // D5: devere dönüşünün dağıtım defteri (kg hep hesaptan → THEORETICAL).
  const allocs = await prisma.warpBeamYarnAllocation.findMany({
    where: { ...LIVE_ALLOCATION, dispatchItem: { dispatch: { subcontractorId, cancelledAt: null } } },
    select: { kg: true, dispatchItem: { select: { yarnItemId: true, lotId: true } } },
  });
  for (const a of allocs) {
    const row = acc.get(`${a.dispatchItem.yarnItemId}|${a.dispatchItem.lotId ?? ""}`);
    if (!row) continue;
    row.sar = row.sar.plus(a.kg);
    row.sarilanKaynak = mergeKgSource(row.sarilanKaynak, "THEORETICAL");
  }
  const data = [...acc.values()]
    .map(({ out, ret, sar, ...r }) => ({ ...r, outKg: Number(out), returnedKg: Number(ret), sarilanKg: Number(sar), remainingKg: Number(out.minus(ret).minus(sar)) }))
    .filter((r) => r.outKg > 0 || r.returnedKg !== 0)
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || (a.lotNo ?? "").localeCompare(b.lotNo ?? ""));
  return { success: true, data };
}
