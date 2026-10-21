// =============================================================================
// LEVENT BİTİŞ TAHMİNİ — "Tezgahtaki leventler günlük hızla ne zaman biter?" (D6, kesit)
// =============================================================================
// Tezgahta bağlı (MOUNTED) her levent: kalan (yalnız `remainingByBeam` → `warpBeamRemainingM`)
// ÷ günlük ortalama (bugün DAHİL son 7 fabrika günündeki geri alınmamış CONSUMED çözgü metresi ÷ 7).
// Hız 0 → tahmin YOK (null + gerekçe). Tüketim `otomatik` (top doğuşu) / `elle` kırılımıyla basılır.
// Bitiş günü fabrika günüdür (`factoryYmd`); bölme helper'da.
// =============================================================================
import { WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { LOOM_HORIZON_DAY, loomHorizonStart } from "../../constants/dokuma-ufku";
import { factoryDayStartOfKey, factoryYmd } from "../../constants/time";
import { remainingByBeam } from "../helpers/warp-beam.helper";
import { addDaysYmd, dailyAverageM, daysToFinish, roundM } from "../helpers/dokuma-levent-rapor.helper";
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
}
export interface FinishForecastReport {
  satirlar: FinishForecastRow[];
  ozet: { leventSayisi: number; tahminli: number; hesaplanamadi: number };
  meta: { ufuk: string; ufukOncesiSatir: number; pencereBaslangic: string; pencereGun: number; secenekler: { machineId: Secenek[] } };
}

export async function finishForecastReport(p: { machineId?: string }): Promise<{ data: FinishForecastReport; dusenSatir?: number }> {
  const today = factoryYmd();
  const windowStartDay = addDaysYmd(today, -(FINISH_RATE_DAYS - 1));
  const windowStart = factoryDayStartOfKey(windowStartDay);
  const beams = await prisma.warpBeam.findMany({
    where: { status: WarpBeamStatus.MOUNTED, currentMachineId: { not: null } },
    select: { id: true, beamNo: true, currentPosition: true, currentMachine: { select: { id: true, code: true, name: true } } },
  });
  const ids = beams.map((b) => b.id);
  const remaining = await remainingByBeam(prisma, ids);
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
    return {
      beamId: b.id, beamNo: b.beamNo, machine: b.currentMachine!, position: b.currentPosition, kalanM: remainingM, gunlukOrtM,
      kaynak: { otomatik, elle },
      tahminiBitisGun: daysLeft === null ? null : addDaysYmd(today, Math.ceil(daysLeft)),
      kalanGun: daysLeft,
      hesaplanamadi: gunlukOrtM === null ? `son ${FINISH_RATE_DAYS} günde tüketim yok` : null,
    };
  });
  rows.sort((a, b) => (a.kalanGun ?? Infinity) - (b.kalanGun ?? Infinity) || a.machine.code.localeCompare(b.machine.code, "tr") || (a.position ?? 0) - (b.position ?? 0));
  const secenekler = { machineId: optionList(rows.map((r) => ({ id: r.machine.id, ad: r.machine.name, kod: r.machine.code }))) };
  const filtered = p.machineId ? rows.filter((r) => r.machine.id === p.machineId) : rows;
  const tahminli = filtered.filter((r) => r.kalanGun !== null).length;
  return {
    data: {
      satirlar: filtered,
      ozet: { leventSayisi: filtered.length, tahminli, hesaplanamadi: filtered.length - tahminli },
      meta: { ufuk: LOOM_HORIZON_DAY, ufukOncesiSatir: filtered.filter((r) => beforeHorizon.has(r.beamId)).length, pencereBaslangic: windowStartDay, pencereGun: FINISH_RATE_DAYS, secenekler },
    },
    ...(p.machineId ? { dusenSatir: rows.length - filtered.length } : {}),
  };
}
