// Patron iş emri "nerede" olguları (`is-emri` projeksiyonu v3) — aşama kırılımı, fason firmaları, sipariş bağları.
// Aşama kümesi TEK tanım (`ROLL_STAGE_WHERE`): sayım (`loadWorkOrderStages`) ve liste süzgeci (`workOrderStageWhere`)
// aynı top parçasından, İE bağı `whereRollsOfWorkOrders` ↔ `whereWorkOrdersOfRolls` ikiziyle kurulur (boğaz-ikiz).
import { Prisma, RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { K18_DEAD_STATUSES } from "../services/batch.service";
import { outstandingItemOfOpenDispatch } from "../services/helpers/fason-open-dispatch.helper";
import { ACTIVE_ORDER_LINK } from "../services/helpers/order-link.helper";
import { KURSUN_FLOW_STEP_WHERE, TAMBUR_FLOW_STEP_WHERE } from "../services/helpers/production-flow-where.helper";
import { STEP_FLOW_WHERE } from "../services/helpers/quality-station.helper";
import { whereWorkOrdersOfRolls } from "../services/helpers/workorder-rolls.helper";

/** Aşama anahtarları — tel sözleşmesi, SABİT sıra. `diger` süzülemez (kalan canlı toplar). */
export const WORK_ORDER_STAGE_KEYS = ["fason", "kursun", "tambur", "depo", "sevkEdildi", "diger"] as const;
export type WorkOrderStageKey = (typeof WORK_ORDER_STAGE_KEYS)[number];
export type FilterableStage = Exclude<WorkOrderStageKey, "diger">;
export const FILTERABLE_STAGES: readonly FilterableStage[] = ["fason", "kursun", "tambur", "depo", "sevkEdildi"];

/** Aşamaya giren canlı top: K18 ölü kümesi sayılmaz (sevk edilmiş top `sevkEdildi`dir, ölü değil). */
const LIVE: Prisma.RollWhereInput = { status: { notIn: K18_DEAD_STATUSES } };
/** Kuyruk aşamaları (kurşun/tambur) yalnız üretimde duran topu sayar; fasonda/depoda/sevkte olan kendi aşamasındadır. */
const QUEUED: Prisma.RollWhereInput = {
  status: { notIn: [...K18_DEAD_STATUSES, RollStatus.AT_SUBCONTRACTOR, RollStatus.WAREHOUSE, RollStatus.SHIPPED] },
};

/**
 * Aşama → top yüklemi. Kurşun/Tambur akış panosunun kuyruk adım yüklemi (`production-flow-where.helper`);
 * hem kart akışı hem Tambur türü taşıyan istasyon Kurşun'dadır (kümeler ayrık kalsın diye Tambur ondan düşülür).
 */
export const ROLL_STAGE_WHERE: Readonly<Record<FilterableStage, Prisma.RollWhereInput>> = {
  fason: { status: RollStatus.AT_SUBCONTRACTOR },
  kursun: { AND: [QUEUED, { currentStep: KURSUN_FLOW_STEP_WHERE }] },
  tambur: { AND: [QUEUED, { currentStep: TAMBUR_FLOW_STEP_WHERE }, { NOT: { currentStep: { station: STEP_FLOW_WHERE } } }] },
  depo: { status: RollStatus.WAREHOUSE },
  sevkEdildi: { status: RollStatus.SHIPPED },
};

/** Liste süzgeci (ERP okuma ucu): bu aşamada en az bir canlı topu olan iş emirleri — sayımın ikizi. */
export function workOrderStageWhere(stage: FilterableStage): Prisma.WorkOrderWhereInput {
  return whereWorkOrdersOfRolls({ AND: [LIVE, ROLL_STAGE_WHERE[stage]] });
}

/** Fasondaki topun bu firmada açık kalemi var — `fasonFirmaIdleri` ve süzgecin ORTAK top yüklemi. */
const rollAtFirm = (subcontractorId?: string): Prisma.RollWhereInput => ({
  AND: [ROLL_STAGE_WHERE.fason, { dispatchItems: { some: outstandingItemOfOpenDispatch(subcontractorId ? { subcontractorId } : undefined) } }],
});

/** Firmada duran canlı top — İE firma süzgeci ve `fason-acik` firma kırılımı (`fason-firm-facts`) AYNI parçadan. */
export const firmRollWhere = (subcontractorId?: string): Prisma.RollWhereInput => ({ AND: [LIVE, rollAtFirm(subcontractorId)] });

/** Liste süzgeci: fasonda bu firmada topu olan iş emirleri — `fasonFirmaIdleri` üyeliğinin ikizi. */
export function workOrderFirmWhere(subcontractorId: string): Prisma.WorkOrderWhereInput {
  return whereWorkOrdersOfRolls(firmRollWhere(subcontractorId));
}

/** Liste süzgeci: bu siparişe açık bağı olan iş emirleri — `siparisIdleri` üyeliğinin ikizi. */
export function workOrderOrderWhere(orderId: string): Prisma.WorkOrderWhereInput {
  return { orderLinks: { some: { ...ACTIVE_ORDER_LINK, orderLine: { orderId } } } };
}

export const ROLL_WO_SELECT = {
  producedInStep: { select: { workOrderId: true } },
  currentStep: { select: { workOrderId: true } },
  batch: { select: { workOrderId: true } },
} as const;
export type RollWoLinks = { producedInStep: { workOrderId: string } | null; currentStep: { workOrderId: string } | null; batch: { workOrderId: string } | null };
/** Topun iş emirleri — `whereRollsOfWorkOrder`un üç bağı; sıra: durduğu adım · parti · üretildiği adım (ilki birincil). */
export const workOrdersOfRoll = (r: RollWoLinks): string[] =>
  [...new Set([r.currentStep?.workOrderId, r.batch?.workOrderId, r.producedInStep?.workOrderId].filter((x): x is string => !!x))];

const metre = (d: Prisma.Decimal): string => d.toFixed(3);

export interface StageCount { anahtar: WorkOrderStageKey; top: number; metre: string }
export interface FirmShare { fasonFirmaId: string | null; ad: string | null; top: number; metre: string; enEskiGonderim: string | null }
export interface WorkOrderWhereabouts {
  asamaTop: StageCount[];
  asamalar: FilterableStage[];
  topSayisi: number;
  metre: string;
  fasonFirmaIdleri: string[];
  fasonFirmalari: FirmShare[];
}
const EMPTY: WorkOrderWhereabouts = { asamaTop: [], asamalar: [], topSayisi: 0, metre: "0.000", fasonFirmaIdleri: [], fasonFirmalari: [] };

type RollRow = { id: string; currentQty: Prisma.Decimal } & RollWoLinks;
type FirmItem = { id: string; rollId: string | null; dispatch: { subcontractorId: string; dispatchedAt: Date; subcontractor: { name: string } } };
type FirmAcc = { item: FirmItem | null; top: number; qty: Prisma.Decimal; oldest: Date | null };
type WoAcc = { stages: Map<WorkOrderStageKey, { top: number; qty: Prisma.Decimal }>; firms: Map<string, FirmAcc>; firmIds: Set<string> };

/** İE'lerin canlı topları + her topun İLK eşleşen aşaması (`FILTERABLE_STAGES` sırası; eşleşmeyen "diger"). */
async function loadRollsWithStage(woIds: readonly string[]): Promise<{ rolls: RollRow[]; stageOf: Map<string, FilterableStage> }> {
  const ids = [...woIds];
  const base: Prisma.RollWhereInput = {
    AND: [LIVE, { OR: [{ producedInStep: { workOrderId: { in: ids } } }, { currentStep: { workOrderId: { in: ids } } }, { batch: { workOrderId: { in: ids } } }] }],
  };
  const rolls = await prisma.roll.findMany({ where: base, select: { id: true, currentQty: true, ...ROLL_WO_SELECT } });
  const stageOf = new Map<string, FilterableStage>();
  for (const stage of FILTERABLE_STAGES) {
    const hit = await prisma.roll.findMany({ where: { AND: [base, ROLL_STAGE_WHERE[stage]] }, select: { id: true } });
    for (const r of hit) if (!stageOf.has(r.id)) stageOf.set(r.id, stage);
  }
  return { rolls, stageOf };
}

/** Fasondaki topların açık kalemleri: top başına en son gönderilen kalem (eşitlikte kalem kimliği) + bütün firmaları. */
async function loadFirmItems(fasonIds: string[]): Promise<{ latest: Map<string, FirmItem>; firmsOfRoll: Map<string, Set<string>> }> {
  const latest = new Map<string, FirmItem>();
  const firmsOfRoll = new Map<string, Set<string>>();
  if (fasonIds.length === 0) return { latest, firmsOfRoll };
  const items = await prisma.subcontractorDispatchItem.findMany({
    where: { ...outstandingItemOfOpenDispatch(), rollId: { in: fasonIds } },
    select: { id: true, rollId: true, dispatch: { select: { subcontractorId: true, dispatchedAt: true, subcontractor: { select: { name: true } } } } },
  });
  for (const it of items) {
    if (!it.rollId) continue;
    const set = firmsOfRoll.get(it.rollId) ?? new Set<string>();
    set.add(it.dispatch.subcontractorId);
    firmsOfRoll.set(it.rollId, set);
    const prev = latest.get(it.rollId);
    const newer = !prev || it.dispatch.dispatchedAt > prev.dispatch.dispatchedAt
      || (it.dispatch.dispatchedAt.getTime() === prev.dispatch.dispatchedAt.getTime() && it.id > prev.id);
    if (newer) latest.set(it.rollId, it);
  }
  return { latest, firmsOfRoll };
}

/** Fason topunu İE birikimine işler: firma payı en son kaleme, firma kimlikleri bütün açık kalemlere. */
function addFasonRoll(a: WoAcc, r: RollRow, latest: Map<string, FirmItem>, firmsOfRoll: Map<string, Set<string>>): void {
  const it = latest.get(r.id) ?? null;
  const key = it?.dispatch.subcontractorId ?? "";
  const f = a.firms.get(key) ?? { item: it, top: 0, qty: new Prisma.Decimal(0), oldest: null };
  f.top++;
  f.qty = f.qty.plus(r.currentQty);
  if (it && (!f.oldest || it.dispatch.dispatchedAt < f.oldest)) f.oldest = it.dispatch.dispatchedAt;
  a.firms.set(key, f);
  for (const id of firmsOfRoll.get(r.id) ?? []) a.firmIds.add(id);
}

/** Birikimi tel biçimine çevirir: aşamalar SABİT sırada, firmalar top ↓ · metre ↓ · kalemsiz sona · kimlik. */
function toWhereabouts(a: WoAcc): WorkOrderWhereabouts {
  let top = 0;
  let qty = new Prisma.Decimal(0);
  const asamaTop: StageCount[] = [];
  for (const k of WORK_ORDER_STAGE_KEYS) {
    const s = a.stages.get(k);
    if (!s) continue;
    top += s.top;
    qty = qty.plus(s.qty);
    asamaTop.push({ anahtar: k, top: s.top, metre: metre(s.qty) });
  }
  const fasonFirmalari = [...a.firms.values()]
    .sort((x, y) => y.top - x.top || y.qty.comparedTo(x.qty) || (x.item ? 0 : 1) - (y.item ? 0 : 1)
      || (x.item?.dispatch.subcontractorId ?? "").localeCompare(y.item?.dispatch.subcontractorId ?? ""))
    .map((f) => ({
      fasonFirmaId: f.item?.dispatch.subcontractorId ?? null, ad: f.item?.dispatch.subcontractor.name ?? null,
      top: f.top, metre: metre(f.qty), enEskiGonderim: f.oldest?.toISOString() ?? null,
    }));
  return {
    asamaTop,
    asamalar: FILTERABLE_STAGES.filter((k) => a.stages.has(k)),
    topSayisi: top,
    metre: metre(qty),
    fasonFirmaIdleri: [...a.firmIds].sort(),
    fasonFirmalari,
  };
}

/**
 * İE başına canlı topların aşama kırılımı + fasondaki topların firma payı. Firma payı: topun açık kalemlerinden en son
 * gönderileni (eşitlikte kalem kimliği); kalemsiz fason topu `fasonFirmaId: null` satırına düşer ⇒ pay toplamı "fason"
 * satırına eşittir. `fasonFirmaIdleri` topun BÜTÜN açık kalem firmalarıdır (süzgeç ikizi).
 */
export async function loadWorkOrderWhereabouts(woIds: readonly string[]): Promise<Map<string, WorkOrderWhereabouts>> {
  const out = new Map<string, WorkOrderWhereabouts>();
  if (woIds.length === 0) return out;
  const asked = new Set(woIds);
  const { rolls, stageOf } = await loadRollsWithStage(woIds);
  const { latest, firmsOfRoll } = await loadFirmItems(rolls.filter((r) => stageOf.get(r.id) === "fason").map((r) => r.id));
  const acc = new Map<string, WoAcc>();
  for (const r of rolls) {
    const stage: WorkOrderStageKey = stageOf.get(r.id) ?? "diger";
    for (const wo of workOrdersOfRoll(r)) {
      if (!asked.has(wo)) continue;
      const a = acc.get(wo) ?? { stages: new Map(), firms: new Map(), firmIds: new Set<string>() };
      const s = a.stages.get(stage) ?? { top: 0, qty: new Prisma.Decimal(0) };
      s.top++;
      s.qty = s.qty.plus(r.currentQty);
      a.stages.set(stage, s);
      if (stage === "fason") addFasonRoll(a, r, latest, firmsOfRoll);
      acc.set(wo, a);
    }
  }
  for (const wo of woIds) {
    const a = acc.get(wo);
    out.set(wo, a ? toWhereabouts(a) : EMPTY);
  }
  return out;
}

/** İE'nin açık sipariş bağları — bağlanma sırasıyla FARKLI siparişler (id + no); `workOrderOrderWhere` ile aynı yüklem. */
export async function loadWorkOrderOrders(woIds: readonly string[]): Promise<Map<string, Array<{ id: string; no: string }>>> {
  const out = new Map<string, Array<{ id: string; no: string }>>();
  if (woIds.length === 0) return out;
  const links = await prisma.workOrderToOrderLine.findMany({
    where: { ...ACTIVE_ORDER_LINK, workOrderId: { in: [...woIds] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { workOrderId: true, orderLine: { select: { order: { select: { id: true, orderNumber: true } } } } },
  });
  for (const l of links) {
    const list = out.get(l.workOrderId) ?? [];
    const o = l.orderLine.order;
    if (!list.some((x) => x.id === o.id)) list.push({ id: o.id, no: o.orderNumber });
    out.set(l.workOrderId, list);
  }
  return out;
}
