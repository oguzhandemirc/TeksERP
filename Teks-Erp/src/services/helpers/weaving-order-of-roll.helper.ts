// =============================================================================
// "BU TOP HANGİ DOKUMA İŞİNDEN?" — TEK OKUYUCU (G2, 2026-09-14)
// =============================================================================
// Üç doğum yolu, tek soru: kendi tezgahında dokunan top İNDİRME üzerinden
// (`Roll.doffEventId → DoffEvent.machineRunId → MachineRun.weavingOrderId`),
// fasonda dokunan top MAKBUZ üzerinden (`Roll.parentReceiptId →
// SubcontractorReceipt.weavingOrderId`), KK1'de iş emri seçilip tezgahı bilinmeyen
// top (S1 A-yolu, D11) DOĞRUDAN `Roll.weavingOrderId` üzerinden. Kolon yalnız
// doff'suz satırda dolar (CHECK `rolls_weaving_order_xor_ck`) — doff'lu topta
// ikinci kaynak olmaz, zincir tek: doff varsa koşumdan, yoksa kolondan.
// Bekçi (`test_subcontractor_weaving §5`) bu zincirleri başka dosyada aramaz.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { K18_DEAD_STATUSES } from "../batch.service";

const Decimal = Prisma.Decimal;

type Db = Prisma.TransactionClient | typeof prisma;

export type WeavingOrderOfRoll = {
  weavingOrderId: string;
  /** DOFF = kendi tezgahı (indirme) · RECEIPT = fason dokuma makbuzu · ORDER = KK1 iş seçimi, tezgah bilinmiyor (S1 A-yolu). */
  via: "DOFF" | "RECEIPT" | "ORDER";
};

/** "Bu işten doğan top" yüklemi (indirme zinciri ∪ doff'suz iş bağı) — sayı (detay), metre/liste (genel bakış) ve gerçek maliyet paydası AYNI where'i okur. */
export function rollsOfWeavingOrderWhere(weavingOrderId: string | string[]): Prisma.RollWhereInput {
  const wo = Array.isArray(weavingOrderId) ? { in: weavingOrderId } : weavingOrderId;
  return { OR: [{ doffEvent: { revokedAt: null, machineRun: { weavingOrderId: wo } } }, { weavingOrderId: wo }] };
}

/** Z1 (Y3 türetme, kolon yok): bu işten indirme yoluyla doğan (iptal edilmemiş) top sayısı — aynı zincir, aynı dosya. */
export async function countRollsOfWeavingOrder(db: Db, weavingOrderId: string): Promise<number> {
  return db.roll.count({ where: rollsOfWeavingOrderWhere(weavingOrderId) });
}

const ROLL_WEAVING_SELECT = {
  id: true,
  weavingOrderId: true,
  doffEvent: { select: { revokedAt: true, machineRun: { select: { weavingOrderId: true, machineId: true } } } },
  parentReceipt: { select: { cancelledAt: true, weavingOrderId: true } },
} as const;

type RollWeavingRow = Prisma.RollGetPayload<{ select: typeof ROLL_WEAVING_SELECT }>;

/** Üç dalın TEK uygulaması (tekil ve toplu okuyucu aynı sırayı okur): indirme → makbuz → doff'suz kolon. */
function pickWeavingOrder(roll: RollWeavingRow): (WeavingOrderOfRoll & { machineId: string | null }) | null {
  const run = roll.doffEvent?.revokedAt ? null : roll.doffEvent?.machineRun ?? null;
  if (run?.weavingOrderId) return { weavingOrderId: run.weavingOrderId, via: "DOFF", machineId: run.machineId };
  const receiptWo = roll.parentReceipt?.cancelledAt ? null : roll.parentReceipt?.weavingOrderId ?? null;
  if (receiptWo) return { weavingOrderId: receiptWo, via: "RECEIPT", machineId: null };
  if (roll.weavingOrderId) return { weavingOrderId: roll.weavingOrderId, via: "ORDER", machineId: null };
  return null;
}

/** Top hiçbir dokuma işine bağlı değilse `null` (uydurulmaz). */
export async function weavingOrderOfRoll(db: Db, rollId: string): Promise<WeavingOrderOfRoll | null> {
  const roll = await db.roll.findUnique({ where: { id: rollId }, select: ROLL_WEAVING_SELECT });
  const hit = roll ? pickWeavingOrder(roll) : null;
  return hit ? { weavingOrderId: hit.weavingOrderId, via: hit.via } : null;
}

/**
 * F4 dokuma hizmet işi — toplu okuyucu (N+1 yok): top → dokuma işi + (indirme yolunda) tezgah. Bağsız top haritada YOK.
 * Zincir `pickWeavingOrder`dadır (tekil okuyucuyla aynı).
 */
export async function weavingOrdersOfRolls(db: Db, rollIds: string[]): Promise<Map<string, WeavingOrderOfRoll & { machineId: string | null }>> {
  const out = new Map<string, WeavingOrderOfRoll & { machineId: string | null }>();
  if (rollIds.length === 0) return out;
  const rows = await db.roll.findMany({ where: { id: { in: rollIds } }, select: ROLL_WEAVING_SELECT });
  for (const r of rows) {
    const hit = pickWeavingOrder(r);
    if (hit) out.set(r.id, hit);
  }
  return out;
}

// ── Satılan topun kökeni: tambur atası + boya/apre makbuzu üzerinden ham topa (K1 dilim 3) ──────────────

/** Topun düşen dokuma işi (yoksa null), topun bu işe düşen payı ve satılan 1 m'ye karşılık ham metre (ölçülemezse null). */
export type RollWeavingOrigin = { weavingOrderId: string | null; share: Prisma.Decimal; hamPerM: Prisma.Decimal | null };
/** Zincirdeki boya/apre makbuzu: makbuzun çıkış metresi ve satılan 1 m'ye düşen çıkış metresi (ölçülemezse null). */
export type RollFinishingPass = { receiptId: string; subcontractorId: string; receivedAt: Date; outputM: Prisma.Decimal; perM: Prisma.Decimal | null };
export type RollOriginTrace = { origins: RollWeavingOrigin[]; passes: RollFinishingPass[] };

const ORIGIN_DEPTH = 12;
const qtyOf = (r: { initialQty: Prisma.Decimal; currentQty: Prisma.Decimal }) => (r.initialQty.gt(0) ? r.initialQty : r.currentQty);
type FinishingReceipt = {
  id: string; subcontractorId: string; receivedAt: Date; bornM: Prisma.Decimal; hasBorn: boolean;
  /** Kalem başına giren (ham) metre: `receivedQty`, NULL kalemde topun kendisi bir kez. */
  inputs: Array<{ rollId: string; qty: Prisma.Decimal }>;
};
type OriginGraph = {
  rolls: Map<string, RollWeavingRow & { parentRollId: string | null; parentReceiptId: string | null }>;
  receipts: Map<string, FinishingReceipt>;
  /** Kendisi dönen top (doğansız makbuz) → makbuz kalemleri. */
  selfReturns: Map<string, Array<{ receiptId: string; qty: Prisma.Decimal }>>;
};

function finishingInputs(items: Array<{ newRollId: string; receivedQty: Prisma.Decimal | null; newRoll: { initialQty: Prisma.Decimal; currentQty: Prisma.Decimal } }>) {
  const seen = new Set<string>();
  return items.flatMap((i) => {
    if (i.receivedQty !== null) return [{ rollId: i.newRollId, qty: i.receivedQty }];
    if (seen.has(i.newRollId)) return [];
    seen.add(i.newRollId);
    return [{ rollId: i.newRollId, qty: qtyOf(i.newRoll) }];
  });
}

/** Ata zincirini katman katman toplar (N+1 yok): top, boya/apre makbuzu (iptalsiz, dokuma makbuzu değil) ve kalemleri. */
async function loadOriginGraph(db: Db, rollIds: string[]): Promise<OriginGraph> {
  const g: OriginGraph = { rolls: new Map(), receipts: new Map(), selfReturns: new Map() };
  let frontier = [...new Set(rollIds)];
  for (let depth = 0; depth < ORIGIN_DEPTH && frontier.length > 0; depth++) {
    const rows = await db.roll.findMany({ where: { id: { in: frontier } }, select: { ...ROLL_WEAVING_SELECT, parentRollId: true, parentReceiptId: true } });
    for (const r of rows) g.rolls.set(r.id, r);
    const self = await db.subcontractorReceiptItem.findMany({
      where: { newRollId: { in: frontier }, receipt: { cancelledAt: null, weavingOrderId: null } }, select: { receiptId: true },
    });
    const wanted = [...new Set([...rows.flatMap((r) => (r.parentReceiptId ? [r.parentReceiptId] : [])), ...self.map((s) => s.receiptId)])].filter((id) => !g.receipts.has(id));
    const receipts = wanted.length === 0 ? [] : await db.subcontractorReceipt.findMany({
      where: { id: { in: wanted }, cancelledAt: null, weavingOrderId: null },
      select: {
        id: true, subcontractorId: true, receivedAt: true, bornRolls: { select: { initialQty: true, currentQty: true } },
        items: { select: { newRollId: true, receivedQty: true, newRoll: { select: { initialQty: true, currentQty: true } } }, orderBy: { id: "asc" } },
      },
    });
    for (const rc of receipts) {
      const inputs = finishingInputs(rc.items);
      g.receipts.set(rc.id, { id: rc.id, subcontractorId: rc.subcontractorId, receivedAt: rc.receivedAt, bornM: rc.bornRolls.reduce((a, b) => a.plus(qtyOf(b)), new Decimal(0)), hasBorn: rc.bornRolls.length > 0, inputs });
      if (rc.bornRolls.length > 0) continue;
      for (const i of inputs) g.selfReturns.set(i.rollId, [...(g.selfReturns.get(i.rollId) ?? []), { receiptId: rc.id, qty: i.qty }]);
    }
    const next = new Set<string>();
    for (const r of rows) if (r.parentRollId) next.add(r.parentRollId);
    for (const rc of g.receipts.values()) if (rc.hasBorn) for (const i of rc.inputs) next.add(i.rollId);
    frontier = [...next].filter((id) => !g.rolls.has(id));
  }
  return g;
}

/** Bir topu köküne yürür: `m` = satılan 1 m'ye karşılık bu topun metresi, `share` = satılan topun bu kola düşen payı. */
type WalkStep = { m: Prisma.Decimal | null; share: Prisma.Decimal; seen: Set<string> };
function walkOrigin(w: { g: OriginGraph; out: RollOriginTrace }, id: string, { m, share, seen }: WalkStep): void {
  const { g, out } = w;
  const node = g.rolls.get(id);
  if (!node || seen.has(id) || seen.size >= ORIGIN_DEPTH * 4) { out.origins.push({ weavingOrderId: null, share, hamPerM: m }); return; }
  seen.add(id);
  const own = g.selfReturns.get(id) ?? [];
  const ownSum = own.reduce((a, s) => a.plus(s.qty), new Decimal(0));
  for (const s of own) {
    const rc = g.receipts.get(s.receiptId)!;
    const perM = m && ownSum.gt(0) ? m.mul(s.qty).div(ownSum) : null;
    out.passes.push({ receiptId: rc.id, subcontractorId: rc.subcontractorId, receivedAt: rc.receivedAt, outputM: rc.inputs.reduce((a, i) => a.plus(i.qty), new Decimal(0)), perM: perM === null ? null : perM.mul(share) });
  }
  const hit = pickWeavingOrder(node);
  if (hit) { out.origins.push({ weavingOrderId: hit.weavingOrderId, share, hamPerM: m }); return; }
  if (node.parentRollId) { walkOrigin(w, node.parentRollId, { m, share, seen }); return; }
  const rc = node.parentReceiptId ? g.receipts.get(node.parentReceiptId) : undefined;
  const inSum = rc ? rc.inputs.reduce((a, i) => a.plus(i.qty), new Decimal(0)) : new Decimal(0);
  if (!rc || inSum.lte(0)) { out.origins.push({ weavingOrderId: null, share, hamPerM: m }); return; }
  out.passes.push({ receiptId: rc.id, subcontractorId: rc.subcontractorId, receivedAt: rc.receivedAt, outputM: rc.bornM, perM: m ? m.mul(share) : null });
  // Doğan topun ham karşılığı makbuz düzeyinde: Σ giren ham ÷ Σ doğan (çekme); kalem payı giren metreyle.
  for (const i of rc.inputs) walkOrigin(w, i.rollId, { m: m && rc.bornM.gt(0) ? m.mul(inSum).div(rc.bornM) : null, share: share.mul(i.qty).div(inSum), seen: new Set(seen) });
}

/**
 * K1 dilim 3 — satılan topun dokuma kökeni: kendi işi → tambur atası (`parentRollId`) → boya/apre makbuzundan doğduysa
 * (`parentReceiptId`, dokuma makbuzu değil) makbuzun kalemlerindeki ham toplar. Aynı işe düşen kollar birleşir; pay Σ = 1.
 */
export async function weavingOriginsOfRolls(db: Db, rollIds: string[]): Promise<Map<string, RollOriginTrace>> {
  const out = new Map<string, RollOriginTrace>();
  if (rollIds.length === 0) return out;
  const g = await loadOriginGraph(db, rollIds);
  for (const id of rollIds) {
    const t: RollOriginTrace = { origins: [], passes: [] };
    walkOrigin({ g, out: t }, id, { m: new Decimal(1), share: new Decimal(1), seen: new Set() });
    const byWo = new Map<string | null, RollWeavingOrigin>();
    for (const o of t.origins) {
      const prev = byWo.get(o.weavingOrderId);
      // Ham metre: kolun payıyla ağırlıklı (kol başına m, kola düşen pay share) — birleşimde Σ (m × pay) / Σ pay.
      const w = o.hamPerM ? o.hamPerM.mul(o.share) : null;
      if (!prev) { byWo.set(o.weavingOrderId, { ...o, hamPerM: w }); continue; }
      byWo.set(o.weavingOrderId, { weavingOrderId: o.weavingOrderId, share: prev.share.plus(o.share), hamPerM: prev.hamPerM && w ? prev.hamPerM.plus(w) : null });
    }
    const origins = [...byWo.values()].map((o) => ({ ...o, hamPerM: o.hamPerM && o.share.gt(0) ? o.hamPerM.div(o.share) : null }));
    origins.sort((a, b) => String(a.weavingOrderId).localeCompare(String(b.weavingOrderId)));
    out.set(id, { origins, passes: t.passes });
  }
  return out;
}

/** Z3: fasonda dokunan işlerin KABUL edilen metresi (makbuz zinciri, iptal edilmemiş makbuz, ölü olmayan top) — iş başına Σ ilk metre. */
export async function receivedMetersByWeavingOrder(db: Db, weavingOrderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (weavingOrderIds.length === 0) return out;
  const rolls = await db.roll.findMany({
    where: { status: { notIn: K18_DEAD_STATUSES }, parentReceipt: { cancelledAt: null, weavingOrderId: { in: weavingOrderIds } } },
    select: { initialQty: true, parentReceipt: { select: { weavingOrderId: true } } },
  });
  for (const r of rolls) { const id = r.parentReceipt?.weavingOrderId; if (id) out.set(id, (out.get(id) ?? 0) + Number(r.initialQty)); }
  return out;
}

/**
 * SY-D3: işin CANLI top metresi (gerçek maliyet paydası), iki kova: `viaRun` indirme→koşum zinciri (B yolu),
 * `viaOrder` KK1 iş seçimi (A yolu, tezgah bilinmiyor). Yalnız İPTAL topu paydaya GİRMEZ; fason/tambur/kartela
 * tüketimi (K18'in diğer üyeleri) dokunan metreyi yok etmez — boyahaneye giden ham top işin paydasında KALIR.
 */
export async function liveRollMetersByWeavingOrder(
  db: Db, weavingOrderIds: string[],
): Promise<Map<string, { viaRun: Prisma.Decimal; viaOrder: Prisma.Decimal }>> {
  const out = new Map<string, { viaRun: Prisma.Decimal; viaOrder: Prisma.Decimal }>();
  for (const [id, rolls] of await liveRollsByWeavingOrder(db, weavingOrderIds)) {
    const cur = { viaRun: new Decimal(0), viaOrder: new Decimal(0) };
    for (const r of rolls) {
      if (r.viaRun) cur.viaRun = cur.viaRun.plus(r.initialQty);
      else cur.viaOrder = cur.viaOrder.plus(r.initialQty);
    }
    out.set(id, cur);
  }
  return out;
}

/** Gerçek maliyet paydasının TOP listesi (aynı yüklem: yalnız İPTAL topu girmez) — devere payı top başına okunur. */
export async function liveRollsByWeavingOrder(
  db: Db, weavingOrderIds: string[],
): Promise<Map<string, Array<{ id: string; initialQty: Prisma.Decimal; viaRun: boolean }>>> {
  const out = new Map<string, Array<{ id: string; initialQty: Prisma.Decimal; viaRun: boolean }>>();
  if (weavingOrderIds.length === 0) return out;
  const rolls = await db.roll.findMany({
    where: { status: { not: RollStatus.CANCELLED }, ...rollsOfWeavingOrderWhere(weavingOrderIds) },
    select: { id: true, initialQty: true, weavingOrderId: true, doffEvent: { select: { revokedAt: true, machineRun: { select: { weavingOrderId: true } } } } },
    orderBy: { id: "asc" },
  });
  for (const r of rolls) {
    const runWo = r.doffEvent && !r.doffEvent.revokedAt ? r.doffEvent.machineRun?.weavingOrderId ?? null : null;
    const id = runWo ?? r.weavingOrderId;
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push({ id: r.id, initialQty: r.initialQty, viaRun: runWo !== null });
    out.set(id, list);
  }
  return out;
}

/**
 * Tablet Dokuma listesi: işten doğan topların Σ ilk metresi, iş başına — genel bakışın `rollMeters`i ile AYNI yüklem
 * (`rollsOfWeavingOrderWhere`, statü süzgeci yok); sayfa kimlikleriyle toplu. Topu olmayan iş haritada YOK (çağıran null der).
 */
export async function rollMetersByWeavingOrder(db: Db, weavingOrderIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (weavingOrderIds.length === 0) return out;
  const rolls = await db.roll.findMany({
    where: rollsOfWeavingOrderWhere(weavingOrderIds),
    select: { initialQty: true, weavingOrderId: true, doffEvent: { select: { revokedAt: true, machineRun: { select: { weavingOrderId: true } } } } },
  });
  for (const r of rolls) {
    // İki kol: geri alınmamış indirme zinciri ya da doff'suz iş bağı (XOR CHECK `rolls_weaving_order_xor_ck`).
    const id = (r.doffEvent && !r.doffEvent.revokedAt ? r.doffEvent.machineRun?.weavingOrderId : null) ?? r.weavingOrderId;
    if (!id) continue;
    const cur = out.get(id);
    out.set(id, cur ? cur.plus(r.initialQty) : r.initialQty);
  }
  return out;
}
