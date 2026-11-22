// =============================================================================
// DEVERECİ KARNESİ — "Hangi devereci zamanında, az fireyle, kusursuz getiriyor?" (devere-levent S2)
// =============================================================================
// Altı ölçü, hepsi deftere dayanır, kopya yüklem yok:
//   teslim/zamanında → sipariş ilk canlı kabulü dönemde (`lead-time` LEAD_ORDER_SELECT + orderLeadSample; termin
//     `delays.effectiveDue`, gün farkı `overdueDaysOf`) · fire → canlı SETTLE kapanışı (`wastePct`, `overTolerance`)
//   ret → dönemde kabul edilen leventlerden iptalsiz ret belgesine girenler · denye → `getDenierDeviationReport`
//   çözgü hatası → `RollError` (PROCESS, grup COZGU) ← CONSUMED.rollId (iptalsiz) ← levent ← devere siparişi.
// Top↔levent bağı yalnız otomatik tüketimle (rollId) kurulur; bağ yoksa "ölçülemedi" beyanı, sıfır değil.
// Bölme `dokuma-levent-rapor.helper`da; `meta.ufuk` = dokuma ufku.
// =============================================================================
import { WarpBeamStatus, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { LOOM_HORIZON_DAY } from "../../constants/dokuma-ufku";
import { factoryYmd, resolveRangeEnd, resolveRangeStart } from "../../constants/time";
import { WARP_DEFECT_GROUP } from "../../constants/hata-gruplari";
import { roundM, roundPct, shareOfPct, weightedAverage } from "../helpers/dokuma-levent-rapor.helper";
import { overdueDaysOf } from "../helpers/fason-expected-return.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "../helpers/roll-error-scope.helper";
import { readDevereAutoConsume } from "../system-setting/modules";
import { getDenierDeviationReport } from "../denier-deviation.service";
import { LEAD_ORDER_SELECT, median, orderLeadSample, readLeadDaysBySubcontractor } from "../warping-order/lead-time";
import { effectiveDue } from "../warping-order/delays";
import { WARPING_SETTLE } from "../warping-order/settle-record";
import { optionList, type Secenek } from "./_secenekler";

/** Dönem tavanı — denye sapma raporuyla aynı (o servis bu karnenin bir ölçüsüdür). */
export const DEVERECI_KARNESI_MAX_DAYS = 366;
const DAY_MS = 86_400_000;

export interface DevereciKarnesiInput { from: string; to: string; subcontractorId?: string }

export interface KarneOlculeri {
  teslim: { siparis: number; terminli: number; zamaninda: number; gecikmeli: number; zamanindaPct: number | null; ortGecikmeGun: number | null };
  sure: { medyanGun: number | null; ornek: number };
  fire: { kapanis: number; ortPct: number | null; enYuksekPct: number | null; toleransAsimi: number };
  ret: { donenLevent: number; reddedilen: number; oranPct: number | null };
  denye: { levent: number; nominalKg: number; tartiNetKg: number; sapmaPct: number | null };
  cozguHatasi: { top: number; kumasM: number; hata: number; yuzMetreBasina: number | null; gerekce: string | null };
}
export interface DevereciKarnesiRow extends KarneOlculeri {
  subcontractor: { id: string; name: string };
  /** Planlamanın kullandığı tahmin (son kapanmış N siparişin medyanı, dönemden bağımsız) — levent bitiş ekranıyla aynı sayı. */
  tahminGun: number | null;
}
export interface DevereciKarnesiReport {
  satirlar: DevereciKarnesiRow[];
  ozet: KarneOlculeri;
  meta: { ufuk: string; otomatikTuketim: boolean; secenekler: { subcontractorId: Secenek[] } };
}

/** Devereci başına ham kova — satır ve özet aynı hesaptan geçer. */
interface Kova {
  leadDays: number[]; terminli: number; zamaninda: number; gecikmeGun: number[]; siparis: number;
  waste: number[]; overTol: number; settles: number;
  donen: number; reddedilen: number;
  denyeLevent: number; nominalKg: number; netKg: number;
  rollM: Map<string, number>; rollHata: Map<string, number>;
}
const yeniKova = (): Kova => ({
  leadDays: [], terminli: 0, zamaninda: 0, gecikmeGun: [], siparis: 0, waste: [], overTol: 0, settles: 0,
  donen: 0, reddedilen: 0, denyeLevent: 0, nominalKg: 0, netKg: 0, rollM: new Map(), rollHata: new Map(),
});
const mean = (xs: number[]): number | null => weightedAverage(xs.map((value) => ({ value, weight: 1 })));

function olcu(k: Kova, autoConsume: boolean): KarneOlculeri {
  const kumasM = roundM([...k.rollM.values()].reduce((a, v) => a + v, 0));
  const hata = [...k.rollM.keys()].reduce((a, id) => a + (k.rollHata.get(id) ?? 0), 0);
  const m = mean(k.waste);
  const ortGecikme = mean(k.gecikmeGun);
  return {
    teslim: { siparis: k.siparis, terminli: k.terminli, zamaninda: k.zamaninda, gecikmeli: k.terminli - k.zamaninda, zamanindaPct: shareOfPct(k.zamaninda, k.terminli), ortGecikmeGun: ortGecikme === null ? null : roundPct(ortGecikme) },
    sure: { medyanGun: median(k.leadDays), ornek: k.leadDays.length },
    fire: { kapanis: k.settles, ortPct: m === null ? null : roundPct(m), enYuksekPct: k.waste.length ? Math.max(...k.waste) : null, toleransAsimi: k.overTol },
    ret: { donenLevent: k.donen, reddedilen: k.reddedilen, oranPct: shareOfPct(k.reddedilen, k.donen) },
    denye: { levent: k.denyeLevent, nominalKg: roundM(k.nominalKg), tartiNetKg: roundM(k.netKg), sapmaPct: shareOfPct(k.netKg - k.nominalKg, k.nominalKg) },
    cozguHatasi: {
      top: k.rollM.size, kumasM, hata,
      // Hata ÷ kumaş metresi × 100 = 100 m başına hata (shareOfPct aynı bölmedir).
      yuzMetreBasina: shareOfPct(hata, kumasM),
      gerekce: kumasM > 0 ? null : autoConsume ? "dönemde topa bağlı levent tüketimi yok" : "otomatik tüketim kapalı — top ile levent bağı kurulmuyor",
    },
  };
}

function resolveRange(p: DevereciKarnesiInput): { from: Date; to: Date } {
  const from = resolveRangeStart(p.from);
  const to = resolveRangeEnd(p.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || factoryYmd(new Date(from.getTime() + DAY_MS / 2)) !== p.from) {
    throw AppError.badRequest("Geçersiz gün (YYYY-MM-DD)", { code: "INVALID_RANGE" });
  }
  if (from > to) throw AppError.badRequest("Başlangıç günü bitiş gününden sonra olamaz", { code: "INVALID_RANGE" });
  if (to.getTime() - from.getTime() > DEVERECI_KARNESI_MAX_DAYS * DAY_MS) throw AppError.badRequest(`Aralık en çok ${DEVERECI_KARNESI_MAX_DAYS} gün olabilir`, { code: "INVALID_RANGE" });
  return { from, to };
}

type Range = { gte: Date; lte: Date };
type KovaOf = (subId: string) => Kova;

/** ① Teslim + süre. */
async function collectDeliveries(inRange: Range, kova: KovaOf): Promise<void> {
  // ① Teslim + süre: ilk canlı kabulü dönemde olan siparişler (aday = dönemde canlı WOUND'u olan, iptal edilmemiş).
  const orders = await prisma.warpingOrder.findMany({
    where: { status: { not: WarpingOrderStatus.CANCELLED }, warpBeams: { some: { status: { not: WarpBeamStatus.CANCELLED }, events: { some: { kind: "WOUND", reversal: null, createdAt: inRange } } } } },
    select: {
      ...LEAD_ORDER_SELECT,
      dispatches: { ...LEAD_ORDER_SELECT.dispatches, select: { ...LEAD_ORDER_SELECT.dispatches.select, expectedReturnAt: true } },
      subcontractorId: true, expectedReturnAt: true,
    },
  });
  for (const o of orders) {
    const s = orderLeadSample(o);
    if (!s.firstReceiptAt || s.firstReceiptAt < inRange.gte || s.firstReceiptAt > inRange.lte) continue;
    const k = kova(o.subcontractorId);
    k.siparis += 1;
    if (s.leadDays !== null) k.leadDays.push(s.leadDays);
    const due = effectiveDue(o.expectedReturnAt, o.dispatches.map((d) => d.expectedReturnAt));
    const late = overdueDaysOf(due.at, s.firstReceiptAt);
    if (late === null) continue;
    k.terminli += 1;
    if (late <= 0) k.zamaninda += 1;
    else k.gecikmeGun.push(late);
  }
}

/** ② Fire · ③ Ret. */
async function collectSettlesAndRejects(inRange: Range, kova: KovaOf): Promise<void> {
  // ② Fire: dönemde yazılmış, yeniden açılmamış kapanışlar.
  const settles = await prisma.warpingOrderSettlement.findMany({
    where: { kind: WARPING_SETTLE, reversal: null, createdAt: inRange },
    select: { wastePct: true, overTolerance: true, warpingOrder: { select: { subcontractorId: true } } },
  });
  for (const s of settles) {
    const k = kova(s.warpingOrder.subcontractorId);
    k.settles += 1;
    if (s.overTolerance) k.overTol += 1;
    if (s.wastePct !== null) k.waste.push(Number(s.wastePct.toString()));
  }

  // ③ Ret: dönemde kabul edilen (canlı WOUND) devere leventleri; payda reddedilenleri de içerir.
  const received = await prisma.warpBeam.findMany({
    where: { warpingOrderId: { not: null }, status: { not: WarpBeamStatus.CANCELLED }, events: { some: { kind: "WOUND", reversal: null, createdAt: inRange } } },
    select: { warpingOrder: { select: { subcontractorId: true } }, rejectionItems: { where: { rejection: { cancelledAt: null } }, select: { id: true }, take: 1 } },
  });
  for (const b of received) {
    if (!b.warpingOrder) continue;
    const k = kova(b.warpingOrder.subcontractorId);
    k.donen += 1;
    if (b.rejectionItems.length > 0) k.reddedilen += 1;
  }
}

/** ④ Çözgü hatası. */
async function collectWarpDefects(inRange: Range, kova: KovaOf, kovalar: ReadonlyMap<string, Kova>): Promise<void> {
  // ④ Çözgü hatası: dönemde topa bağlı (rollId) iptalsiz tüketim → top başına kumaş metresi (aynı deverecinin iki leventi
  // aynı topu besliyorsa top bir kez sayılır, en büyük metre); hatalar o topların COZGU grubundaki saha hataları.
  const consumed = await prisma.warpBeamEvent.findMany({
    where: { kind: "CONSUMED", reversal: null, rollId: { not: null }, createdAt: inRange, beam: { warpingOrderId: { not: null } } },
    select: { rollId: true, fabricLengthM: true, beam: { select: { warpingOrder: { select: { subcontractorId: true } } } } },
  });
  for (const e of consumed) {
    const subId = e.beam.warpingOrder?.subcontractorId;
    if (!subId || !e.rollId) continue;
    const k = kova(subId);
    const m = e.fabricLengthM === null ? 0 : Number(e.fabricLengthM.toString());
    k.rollM.set(e.rollId, Math.max(k.rollM.get(e.rollId) ?? 0, m));
  }
  const rollIds = [...new Set(consumed.flatMap((e) => (e.rollId ? [e.rollId] : [])))];
  const defectsByRoll = new Map<string, number>();
  if (rollIds.length) {
    const errs = await prisma.rollError.groupBy({
      by: ["rollId"],
      where: { ...ACTIONABLE_ROLL_ERROR_WHERE, rollId: { in: rollIds }, defectType: { defectGroup: WARP_DEFECT_GROUP } },
      _count: { _all: true },
    });
    for (const g of errs) defectsByRoll.set(g.rollId, g._count._all);
  }
  for (const k of kovalar.values()) for (const id of k.rollM.keys()) k.rollHata.set(id, defectsByRoll.get(id) ?? 0);
}

/** ⑤ Denye: devereci başına denye sapma raporunun (tek tanım) iplik + karma satırları toplanır. */
async function collectDenier(p: DevereciKarnesiInput, kovalar: ReadonlyMap<string, Kova>): Promise<void> {
  for (const [id, k] of kovalar) {
    const d = await getDenierDeviationReport({ from: p.from, to: p.to, subcontractorId: id });
    for (const r of [...d.rows, ...(d.mixed ? [d.mixed] : [])]) {
      k.denyeLevent += r.beamCount;
      k.nominalKg += Number(r.nominalKg);
      k.netKg += Number(r.weighedNetKg);
    }
  }
}

/** Özet kovası: süzgeçteki deverecilerin kovaları birleşir (oranlar Σ/Σ). */
function mergeKovalar(kovalar: ReadonlyMap<string, Kova>, only?: string): Kova {
  const total = yeniKova();
  for (const [id, k] of kovalar) {
    if (only && id !== only) continue;
    total.leadDays.push(...k.leadDays);
    total.gecikmeGun.push(...k.gecikmeGun);
    total.waste.push(...k.waste);
    total.siparis += k.siparis; total.terminli += k.terminli; total.zamaninda += k.zamaninda;
    total.settles += k.settles; total.overTol += k.overTol; total.donen += k.donen; total.reddedilen += k.reddedilen;
    total.denyeLevent += k.denyeLevent; total.nominalKg += k.nominalKg; total.netKg += k.netKg;
    // Top kimliği devereci önekiyle: iki deverecinin leventinden doğan top her birinde ayrı sayılır.
    for (const [rid, m] of k.rollM) { total.rollM.set(`${id}:${rid}`, m); total.rollHata.set(`${id}:${rid}`, k.rollHata.get(rid) ?? 0); }
  }
  return total;
}

export async function devereciKarnesiReport(p: DevereciKarnesiInput): Promise<{ data: DevereciKarnesiReport; dusenSatir?: number; range: { from: Date; to: Date } }> {
  const range = resolveRange(p);
  const inRange = { gte: range.from, lte: range.to };
  const kovalar = new Map<string, Kova>();
  const kova: KovaOf = (subId) => {
    let k = kovalar.get(subId);
    if (!k) kovalar.set(subId, (k = yeniKova()));
    return k;
  };
  await collectDeliveries(inRange, kova);
  await collectSettlesAndRejects(inRange, kova);
  await collectWarpDefects(inRange, kova, kovalar);
  await collectDenier(p, kovalar);

  const subIds = [...kovalar.keys()];
  const subs = subIds.length ? await prisma.subcontractor.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true } }) : [];
  const autoConsume = await readDevereAutoConsume();
  const lead = await readLeadDaysBySubcontractor(prisma, subIds);
  const nameOf = new Map(subs.map((s) => [s.id, s.name]));
  const all: DevereciKarnesiRow[] = subIds
    .map((id) => ({ subcontractor: { id, name: nameOf.get(id) ?? id }, tahminGun: lead.get(id)?.leadDays ?? null, ...olcu(kovalar.get(id)!, autoConsume) }))
    .sort((a, b) => a.subcontractor.name.localeCompare(b.subcontractor.name, "tr") || a.subcontractor.id.localeCompare(b.subcontractor.id));
  const rows = p.subcontractorId ? all.filter((r) => r.subcontractor.id === p.subcontractorId) : all;
  return {
    data: {
      satirlar: rows,
      ozet: olcu(mergeKovalar(kovalar, p.subcontractorId), autoConsume),
      meta: { ufuk: LOOM_HORIZON_DAY, otomatikTuketim: autoConsume, secenekler: { subcontractorId: optionList(all.map((r) => ({ id: r.subcontractor.id, ad: r.subcontractor.name }))) } },
    },
    ...(p.subcontractorId ? { dusenSatir: all.length - rows.length } : {}),
    range,
  };
}
