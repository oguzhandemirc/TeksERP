// =============================================================================
// LEVENT SONUCU — "Her leventten beklenen kumaş çıktı mı, fire ne kadar?" (DOKUMA-MANUEL D6)
// =============================================================================
// Levent dengesi: sarılan çözgü → beklenen kumaş (take-up) → gerçek kumaş (CONSUMED.fabricLengthM)
// → fire. İKİ DEĞİŞMEZ (dokuma.md): ① gerçek kumaş `otomatik` (top doğuşu, rollId dolu) / `elle`
// kırılımıyla basılır, tek sayıya çökertilmez; ② `meta.ufuk` yazılır. Fire YALNIZ kapanmış
// (EXHAUSTED|SCRAPPED) leventte; pencere = aktif kapanış olayının fabrika günü; açık leventler kesit.
// Kalan metre yalnız `remainingByBeam` (→ `warpBeamRemainingM`, tek okuyucu); bölme helper'da.
// H5 borcu: top metresi sonradan değiştiyse otomatik tüketim doğuş metresinde donar — sayısı
// `meta.duzeltilmisTop` ile beyan edilir.
// =============================================================================
import { WarpBeamStatus, type WarpKgSource } from "@prisma/client";
import prisma from "../../lib/prisma";
import { LOOM_HORIZON_DAY, loomHorizonStart } from "../../constants/dokuma-ufku";
import { resolveRangeEnd, resolveRangeStart } from "../../constants/time";
import { remainingByBeam } from "../helpers/warp-beam.helper";
import { expectedFabricM, roundM, shareOfPct, usedSharePct } from "../helpers/dokuma-levent-rapor.helper";
import { readWarpLayersForItems } from "../helpers/effective-construction.helper";
import { beamLayerTag, type BeamLayerTag } from "../helpers/warp-layer-beam.helper";
import { optionList, type Secenek } from "./_secenekler";

const CLOSED: WarpBeamStatus[] = [WarpBeamStatus.EXHAUSTED, WarpBeamStatus.SCRAPPED];
const CLOSING_KINDS = ["EXHAUSTED", "SCRAPPED"];

export type KgSourceMix = WarpKgSource | "KARMA" | null;
export interface SourceBreakdown { otomatik: number; elle: number }
export interface BeamResultRow {
  beamId: string;
  beamNo: string;
  physicalBeamNo: string | null;
  warpSpec: { id: string; code: string; name: string; takeUpPct: number | null };
  /** SY-B2: yalnız bağlı işin ürününde ek çözgü katmanı varken — zemin mi, döner/ek mi (tek katmanlıda anahtar YOK). */
  katman?: BeamLayerTag;
  sarilanM: number;
  sarilanKg: number | null;
  kgKaynak: KgSourceMix;
  beklenenKumasM: number | null;
  gercekKumasM: number;
  gercekKaynak: SourceBreakdown;
  kalanM: number;
  fireM: number | null;
  firePct: number | null;
  status: WarpBeamStatus;
  kapanisAt: Date | null;
  tezgahlar: string[];
  /** Yalnız açık leventte: (sarılan − kalan) ÷ sarılan. */
  kullanimPct?: number | null;
}
export interface BeamResultSummary {
  leventSayisi: number;
  sarilanM: number;
  /** Take-up'ı bilinen kapanmış leventlerin beklenen toplamı (fireM/firePct paydası). */
  beklenenM: number;
  gercekM: number;
  gercekKaynak: SourceBreakdown;
  fireM: number;
  firePct: number | null;
  /** Take-up bilinmediği için beklenen/fire hesaplanamayan kapanmış levent sayısı. */
  olculemedi: number;
  acikLeventSayisi: number;
}
export interface BeamResultMeta {
  ufuk: string;
  ufukOncesiSatir: number;
  /** H5: otomatik tüketimde top metresi (`initialQty`) tüketim anındaki kumaş metresinden farklı olan top sayısı. */
  duzeltilmisTop: number;
  /** Kumaş metresi girilmeden yazılmış tüketim satırı (elle/ölçüm kapatma) — fire içinde kalır. */
  kumasiOlculmeyenTuketim: number;
  secenekler: { warpSpecId: Secenek[]; machineId: Secenek[] };
}
export interface BeamResultReport {
  kapananlar: BeamResultRow[];
  acikLeventler: BeamResultRow[];
  ozet: BeamResultSummary;
  meta: BeamResultMeta;
}
export interface BeamResultInput { from: string; to: string; warpSpecId?: string; machineId?: string }

/** Yanıta girmeyen iç kolonlar (süzgeç ekseni, ufuk, H5 sayaçları). */
interface HiddenCols { machineIds: string[]; beforeHorizon: boolean; unmeasured: number; adjusted: number }
const sumOf = (rows: HiddenCols[], k: "unmeasured" | "adjusted"): number => rows.reduce((a, r) => a + r[k], 0);
const num = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : Number(v.toString()));

/** Özet yalnız KAPANAN leventlerden; take-up'sız levent oranın dışında, `olculemedi`de sayılır. */
function summarizeClosed(kapananlar: BeamResultRow[], openCount: number): BeamResultSummary {
  const measurable = kapananlar.filter((r) => r.beklenenKumasM !== null);
  const beklenenM = roundM(measurable.reduce((a, r) => a + r.beklenenKumasM!, 0));
  const fireTotal = roundM(measurable.reduce((a, r) => a + (r.fireM ?? 0), 0));
  return {
    leventSayisi: kapananlar.length,
    sarilanM: roundM(kapananlar.reduce((a, r) => a + r.sarilanM, 0)),
    beklenenM,
    gercekM: roundM(kapananlar.reduce((a, r) => a + r.gercekKumasM, 0)),
    gercekKaynak: {
      otomatik: roundM(kapananlar.reduce((a, r) => a + r.gercekKaynak.otomatik, 0)),
      elle: roundM(kapananlar.reduce((a, r) => a + r.gercekKaynak.elle, 0)),
    },
    fireM: fireTotal,
    firePct: shareOfPct(fireTotal, beklenenM),
    olculemedi: kapananlar.length - measurable.length,
    acikLeventSayisi: openCount,
  };
}

/** Pencerede KAPANAN leventler (kapanış anıyla) + şu an açık (takılı ya da tüketimi başlamış) leventler. */
async function beamIdsInRange(range: { from: Date; to: Date }): Promise<{ closedAt: Map<string, Date>; ids: string[] }> {
  const closing = await prisma.warpBeamEvent.findMany({
    where: { kind: { in: CLOSING_KINDS }, reversal: null, createdAt: { gte: range.from, lte: range.to }, beam: { status: { in: CLOSED } } },
    select: { beamId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const closedAt = new Map(closing.map((e) => [e.beamId, e.createdAt]));
  const open = await prisma.warpBeam.findMany({
    where: { OR: [{ status: WarpBeamStatus.MOUNTED }, { status: WarpBeamStatus.READY, events: { some: { kind: "CONSUMED", reversal: null } } }] },
    select: { id: true },
  });
  const ids = [...new Set([...closedAt.keys(), ...open.map((b) => b.id)])];
  return { closedAt, ids };
}

type BeamWithOrder = { id: string; warpSpec: { id: string }; weavingOrder: { itemId: string; warpSpecId: string | null; item: { warpSpecId: string | null } } | null };
/** SY-B2: bağlı işin ürününde ek katman varsa leventin yeri (zemin/döner/ek) — katmanlar toplu, tek sorgu. */
async function layerTagsByBeam(beams: BeamWithOrder[]): Promise<Map<string, BeamLayerTag>> {
  const layersByItem = await readWarpLayersForItems(prisma, [...new Set(beams.flatMap((b) => (b.weavingOrder ? [b.weavingOrder.itemId] : [])))]);
  const out = new Map<string, BeamLayerTag>();
  for (const b of beams) {
    const wo = b.weavingOrder;
    if (!wo) continue;
    const layers = (layersByItem.get(wo.itemId) ?? []).map((l) => ({ warpSpecId: l.warpSpec.id, role: l.role, beamMode: l.beamMode }));
    const tag = beamLayerTag(b.warpSpec.id, wo.warpSpecId ?? wo.item.warpSpecId, layers);
    if (tag) out.set(b.id, tag);
  }
  return out;
}

export async function beamResultReport(p: BeamResultInput): Promise<{ data: BeamResultReport; dusenSatir?: number; range: { from: Date; to: Date } }> {
  const range = { from: resolveRangeStart(p.from), to: resolveRangeEnd(p.to) };
  const { closedAt, ids } = await beamIdsInRange(range);
  const beams = ids.length
    ? await prisma.warpBeam.findMany({
        where: { id: { in: ids } },
        select: { id: true, beamNo: true, physicalBeamNo: true, status: true, currentMachineId: true, warpSpec: { select: { id: true, code: true, name: true, takeUpPct: true } }, weavingOrder: { select: { itemId: true, warpSpecId: true, item: { select: { warpSpecId: true } } } } },
        orderBy: { beamNo: "asc" },
      })
    : [];
  const events = ids.length
    ? await prisma.warpBeamEvent.findMany({
        where: { beamId: { in: ids }, kind: { in: ["WOUND", "CONSUMED", "MOUNTED"] }, reversal: null },
        select: { beamId: true, kind: true, lengthM: true, theoreticalKg: true, kgSource: true, fabricLengthM: true, rollId: true, machineId: true, createdAt: true, roll: { select: { initialQty: true } } },
      })
    : [];
  const remaining = await remainingByBeam(prisma, ids);
  const layerTags = await layerTagsByBeam(beams);
  const machineIds = [...new Set([...events.map((e) => e.machineId), ...beams.map((b) => b.currentMachineId)].filter((x): x is string => !!x))];
  const machines = machineIds.length ? await prisma.machine.findMany({ where: { id: { in: machineIds } }, select: { id: true, code: true, name: true } }) : [];
  const machineById = new Map(machines.map((m) => [m.id, m]));

  const horizon = loomHorizonStart().getTime();
  const eventsByBeam = new Map<string, typeof events>();
  for (const e of events) eventsByBeam.set(e.beamId, [...(eventsByBeam.get(e.beamId) ?? []), e]);
  const rows: Array<BeamResultRow & HiddenCols> = beams.map((b) => {
    const ev = eventsByBeam.get(b.id) ?? [];
    const wound = ev.filter((e) => e.kind === "WOUND");
    const consumed = ev.filter((e) => e.kind === "CONSUMED");
    const mountMachines = [...new Set([...ev.filter((e) => e.kind === "MOUNTED").map((e) => e.machineId), b.currentMachineId].filter((x): x is string => !!x))];
    const sarilanM = roundM(wound.reduce((a, e) => a + (num(e.lengthM) ?? 0), 0));
    const kgValues = wound.map((e) => num(e.theoreticalKg)).filter((x): x is number => x !== null);
    const kgSources = [...new Set(wound.map((e) => e.kgSource).filter((x): x is WarpKgSource => !!x))];
    const otomatik = roundM(consumed.filter((e) => e.rollId).reduce((a, e) => a + (num(e.fabricLengthM) ?? 0), 0));
    const elle = roundM(consumed.filter((e) => !e.rollId).reduce((a, e) => a + (num(e.fabricLengthM) ?? 0), 0));
    const takeUp = num(b.warpSpec.takeUpPct);
    const beklenen = expectedFabricM(sarilanM, takeUp);
    const gercek = roundM(otomatik + elle);
    const closedRow = CLOSED.includes(b.status) && closedAt.has(b.id);
    const remainingM = remaining.get(b.id) ?? 0;
    const fireM = closedRow && beklenen !== null ? roundM(beklenen - gercek) : null;
    const katman = layerTags.get(b.id);
    const firstWound = wound.reduce<Date | null>((a, e) => (a === null || e.createdAt < a ? e.createdAt : a), null);
    return {
      beamId: b.id, beamNo: b.beamNo, physicalBeamNo: b.physicalBeamNo,
      warpSpec: { id: b.warpSpec.id, code: b.warpSpec.code, name: b.warpSpec.name, takeUpPct: takeUp },
      ...(katman ? { katman } : {}),
      sarilanM, sarilanKg: kgValues.length ? roundM(kgValues.reduce((a, v) => a + v, 0)) : null,
      kgKaynak: kgSources.length > 1 ? "KARMA" : (kgSources[0] ?? null),
      beklenenKumasM: beklenen, gercekKumasM: gercek, gercekKaynak: { otomatik, elle }, kalanM: remainingM,
      fireM, firePct: fireM !== null && beklenen !== null ? shareOfPct(fireM, beklenen) : null,
      status: b.status, kapanisAt: closedRow ? closedAt.get(b.id)! : null,
      tezgahlar: mountMachines.map((id) => machineById.get(id)?.code ?? id).sort(),
      ...(closedRow ? {} : { kullanimPct: usedSharePct(sarilanM, remainingM) }),
      machineIds: mountMachines, beforeHorizon: firstWound !== null && firstWound.getTime() < horizon,
      unmeasured: consumed.filter((e) => e.fabricLengthM === null).length,
      adjusted: consumed.filter((e) => e.rollId && e.roll && e.fabricLengthM !== null && !e.roll.initialQty.equals(e.fabricLengthM)).length,
    };
  });

  const secenekler = {
    warpSpecId: optionList(rows.map((r) => ({ id: r.warpSpec.id, ad: r.warpSpec.name, kod: r.warpSpec.code }))),
    machineId: optionList(rows.flatMap((r) => r.machineIds.map((id) => ({ id, ad: machineById.get(id)?.name ?? id, kod: machineById.get(id)?.code ?? null })))),
  };
  const filtered = rows.filter((r) => (!p.warpSpecId || r.warpSpec.id === p.warpSpecId) && (!p.machineId || r.machineIds.includes(p.machineId)));
  const strip = ({ machineIds: _m, beforeHorizon: _b, unmeasured: _u, adjusted: _a, ...r }: (typeof rows)[number]): BeamResultRow => r;
  const kapananlar = filtered.filter((r) => r.kapanisAt !== null).sort((a, b) => a.kapanisAt!.getTime() - b.kapanisAt!.getTime());
  const openRows = filtered.filter((r) => r.kapanisAt === null);
  const summary = summarizeClosed(kapananlar, openRows.length);
  const hasFilter = !!(p.warpSpecId || p.machineId);
  return {
    data: {
      kapananlar: kapananlar.map(strip),
      acikLeventler: openRows.map(strip),
      ozet: summary,
      meta: { ufuk: LOOM_HORIZON_DAY, ufukOncesiSatir: filtered.filter((r) => r.beforeHorizon).length, duzeltilmisTop: sumOf(filtered, "adjusted"), kumasiOlculmeyenTuketim: sumOf(filtered, "unmeasured"), secenekler },
    },
    ...(hasFilter ? { dusenSatir: rows.length - filtered.length } : {}),
    range,
  };
}
