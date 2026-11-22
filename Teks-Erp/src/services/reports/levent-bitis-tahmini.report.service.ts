// =============================================================================
// LEVENT BİTİŞ TAHMİNİ — "Tezgahtaki leventler günlük hızla ne zaman biter?" (D6, kesit)
// =============================================================================
// Tezgahta bağlı (MOUNTED) her levent: kalan (yalnız `remainingByBeam` → `warpBeamRemainingM`)
// ÷ günlük ortalama (bugün DAHİL son 7 fabrika günündeki geri alınmamış CONSUMED çözgü metresi ÷ 7).
// Hız 0 → tahmin YOK (null + gerekçe). Tüketim `otomatik` (top doğuşu) / `elle` kırılımıyla basılır.
// Bitiş günü fabrika günüdür (`factoryYmd`); bölme helper'da.
// S1 (devere zamanlaması): aynı kartın yedeği (READY levent `readBeamStockBySpec` + açık devere kalanı
// `readWarpSupplyBySpec`), teslim süresi (`warping-order/lead-time`) ve "devereye ver" günü = bitiş − ⌈süre⌉.
// Süre ya da bitiş yoksa gün null + gerekçe; uydurma yok. Eski alanlar aynı kalır, yeniler yalnız eklenir.
// =============================================================================
import { WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { LOOM_HORIZON_DAY, loomHorizonStart } from "../../constants/dokuma-ufku";
import { factoryDayStartOfKey, factoryYmd } from "../../constants/time";
import { remainingByBeam } from "../helpers/warp-beam.helper";
import { readBeamStockBySpec } from "../helpers/warp-beam-stock.helper";
import { readWarpSupplyBySpec } from "../helpers/warp-supply.helper";
import { addDaysYmd, dailyAverageM, daysToFinish, roundM } from "../helpers/dokuma-levent-rapor.helper";
import { readLeadDaysBySpec, type LeadSource } from "../warping-order/lead-time";
import { readDevereDefaultLeadDays } from "../system-setting.service";
import { optionList, type Secenek } from "./_secenekler";

/** Hız penceresi: bugün dahil son 7 fabrika günü. */
export const FINISH_RATE_DAYS = 7;

export interface FinishForecastRow {
  beamId: string;
  beamNo: string;
  machine: { id: string; code: string; name: string };
  position: number | null;
  kalanM: number;
  gunlukOrtM: number | null;
  /** Son 7 gün tüketiminin (çözgü m) kaynağı: top doğuşundan otomatik / elle. */
  kaynak: { otomatik: number; elle: number };
  tahminiBitisGun: string | null;
  kalanGun: number | null;
  hesaplanamadi: string | null;
  /** S1: leventin çözgü kartı. */
  warpSpec: { id: string; code: string; name: string };
  /** S1: aynı kartın yedeği — READY (kalanı > 0) levent adedi/metresi + açık devere siparişi kalanı ("yolda"). */
  spare: { count: number; m: number; yoldaM: number; yoldaSiparis: number };
  /** S1: devere teslim süresi (gün; medyan ya da ayar yedeği); ölçülemezse null. */
  leadDays: number | null;
  lead: { kaynak: LeadSource | null; ornek: number; devereci: string | null };
  /** S1: devereye en geç verilecek fabrika günü = bitiş − ⌈leadDays⌉; hesaplanamazsa null + `orderByGerekce`. */
  orderByDay: string | null;
  orderByGerekce: string | null;
  /** S1: yedek yok (hazır levent de yolda sipariş de yok) ∧ devereye ver günü bugün ya da geçmiş. */
  devereAcil: boolean;
}
export interface FinishForecastReport {
  satirlar: FinishForecastRow[];
  ozet: { leventSayisi: number; tahminli: number; hesaplanamadi: number; devereAcil: number };
  meta: { ufuk: string; ufukOncesiSatir: number; pencereBaslangic: string; pencereGun: number; secenekler: { machineId: Secenek[] } };
}

export async function finishForecastReport(p: { machineId?: string }): Promise<{ data: FinishForecastReport; dusenSatir?: number }> {
  const today = factoryYmd();
  const windowStartDay = addDaysYmd(today, -(FINISH_RATE_DAYS - 1));
  const windowStart = factoryDayStartOfKey(windowStartDay);
  const beams = await prisma.warpBeam.findMany({
    where: { status: WarpBeamStatus.MOUNTED, currentMachineId: { not: null } },
    select: { id: true, beamNo: true, currentPosition: true, currentMachine: { select: { id: true, code: true, name: true } }, warpSpec: { select: { id: true, code: true, name: true } } },
  });
  const ids = beams.map((b) => b.id);
  const remaining = await remainingByBeam(prisma, ids);
  const specIds = [...new Set(beams.map((b) => b.warpSpec.id))];
  const stock = await readBeamStockBySpec(prisma, specIds);
  const supply = await readWarpSupplyBySpec(prisma, specIds);
  const leads = await readLeadDaysBySpec(prisma, specIds, await readDevereDefaultLeadDays());
  const consumed = ids.length
    ? await prisma.warpBeamEvent.findMany({ where: { beamId: { in: ids }, kind: "CONSUMED", reversal: null, createdAt: { gte: windowStart } }, select: { beamId: true, lengthM: true, rollId: true } })
    : [];
  const wound = ids.length
    ? await prisma.warpBeamEvent.findMany({ where: { beamId: { in: ids }, kind: "WOUND", reversal: null }, select: { beamId: true, createdAt: true } })
    : [];
  const horizon = loomHorizonStart().getTime();
  const beforeHorizon = new Set(wound.filter((w) => w.createdAt.getTime() < horizon).map((w) => w.beamId));

  const rows: FinishForecastRow[] = beams.map((b) => {
    const mine = consumed.filter((c) => c.beamId === b.id);
    const otomatik = roundM(mine.filter((c) => c.rollId).reduce((a, c) => a + Number(c.lengthM ?? 0), 0));
    const elle = roundM(mine.filter((c) => !c.rollId).reduce((a, c) => a + Number(c.lengthM ?? 0), 0));
    const gunlukOrtM = dailyAverageM(otomatik + elle, FINISH_RATE_DAYS);
    const remainingM = remaining.get(b.id) ?? 0;
    const daysLeft = daysToFinish(remainingM, gunlukOrtM);
    const finishDay = daysLeft === null ? null : addDaysYmd(today, Math.ceil(daysLeft));
    const ready = (stock.get(b.warpSpec.id) ?? []).filter((s) => s.status === WarpBeamStatus.READY);
    const sup = supply.get(b.warpSpec.id);
    const spare = {
      count: ready.length,
      m: roundM(ready.reduce((a, s) => a + s.remainingM, 0)),
      yoldaM: sup?.openWarpingM ?? 0,
      yoldaSiparis: sup?.openWarpingOrders.filter((o) => o.remainingM > 0).length ?? 0,
    };
    const lead = leads.get(b.warpSpec.id);
    const leadDays = lead?.leadDays ?? null;
    const orderByDay = finishDay !== null && leadDays !== null ? addDaysYmd(finishDay, -Math.ceil(leadDays)) : null;
    const orderByGerekce = orderByDay !== null ? null : finishDay === null ? "bitiş tahmini yok" : (lead?.reason ?? "teslim süresi ölçülemedi");
    return {
      beamId: b.id, beamNo: b.beamNo, machine: b.currentMachine!, position: b.currentPosition, kalanM: remainingM, gunlukOrtM,
      kaynak: { otomatik, elle },
      tahminiBitisGun: finishDay,
      kalanGun: daysLeft,
      hesaplanamadi: gunlukOrtM === null ? `son ${FINISH_RATE_DAYS} günde tüketim yok` : null,
      warpSpec: b.warpSpec,
      spare,
      leadDays,
      lead: { kaynak: lead?.source ?? null, ornek: lead?.sampleCount ?? 0, devereci: lead?.subcontractor?.name ?? null },
      orderByDay,
      orderByGerekce,
      devereAcil: spare.count === 0 && spare.yoldaM <= 0 && orderByDay !== null && orderByDay <= today,
    };
  });
  rows.sort((a, b) => (a.kalanGun ?? Infinity) - (b.kalanGun ?? Infinity) || a.machine.code.localeCompare(b.machine.code, "tr") || (a.position ?? 0) - (b.position ?? 0));
  const secenekler = { machineId: optionList(rows.map((r) => ({ id: r.machine.id, ad: r.machine.name, kod: r.machine.code }))) };
  const filtered = p.machineId ? rows.filter((r) => r.machine.id === p.machineId) : rows;
  const tahminli = filtered.filter((r) => r.kalanGun !== null).length;
  return {
    data: {
      satirlar: filtered,
      ozet: { leventSayisi: filtered.length, tahminli, hesaplanamadi: filtered.length - tahminli, devereAcil: filtered.filter((r) => r.devereAcil).length },
      meta: { ufuk: LOOM_HORIZON_DAY, ufukOncesiSatir: filtered.filter((r) => beforeHorizon.has(r.beamId)).length, pencereBaslangic: windowStartDay, pencereGun: FINISH_RATE_DAYS, secenekler },
    },
    ...(p.machineId ? { dusenSatir: rows.length - filtered.length } : {}),
  };
}
