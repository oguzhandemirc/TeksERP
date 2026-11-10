// =============================================================================
// BEYAN ↔ ÖLÇÜLEN METRE — TEK ÇÖZÜCÜ (GK metre sözleşmesi, kullanıcı kararları 2026-11-10)
// =============================================================================
// Soru: "bu partide müşteri kaç metre beyan etti, biz kaç metre ölçtük, kaç metre faturalanır?"
// Parti = topun KÖKÜ (ata zinciri tırmanılır) → kökün gelen belge satırı (not + blok) → kökün partisi (`batchId`) → kökün kendisi.
// Beyan (kural 6): partinin basılı toplamı (özet/parti satırı ya da belge blok beyanı) → İE'ye giriş (kökün ilk hareket
// qtyIn'i) → doğuş (`initialQty`) toplamı. Ölçüm: kurşun OUT sayacı · Tambur kesimi (CUT); SIMULATED hiçbir toplama girmez
// (K4 çekirdek). Ata ölçüldüyse çocuğun aynı tür ölçümü ikinci kez sayılmaz. "Tambura giren" hareketin giriş metresidir
// (sayaç değil, sistemin o anki metresi) — bilgi; ölçülen en büyüğe girmez.
// Faturalanan (kural 1–2): partinin ölçümlerinin EN BÜYÜĞÜ beyandan %0,5 ve daha fazla uzunsa ölçülen, değilse beyan.
// İE karşılaştırması ve top izi (`meter-comparison.service`) ile hizmet faturası (`MAX_DECLARED`) bu dosyadan okur; ikinci kopya yok.
// Yalnız okur.
// =============================================================================
import { MachineDataSource, MeterPhase, Prisma, RollStatus, StationKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { partyLineId } from "../gelen-belge-kontrol.service";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "./roll-error-scope.helper";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";

type Db = Prisma.TransactionClient | typeof prisma;
type D = Prisma.Decimal;
const D0 = () => new Prisma.Decimal(0);

/** Kural 1 toleransı (yüzde): |ölçülen − beyan| / beyan bunun ALTINDAYSA beyan faturalanır. */
export const METER_COMPARE_TOLERANCE_PCT = 0.5;

export type DeclaredSource = "DOCUMENT" | "WORK_ORDER" | "ROLL_INITIAL";
export type BilledBasis = "DECLARED" | "MEASURED";

export interface BilledDecision {
  billedM: number | null;
  billedBasis: BilledBasis | null;
  diffM: number | null;
  diffPct: number | null;
  withinTolerance: boolean;
  longerThanDeclared: boolean;
}

const num = (v: D | null): number | null => (v === null ? null : Number(v.toFixed(3)));

/** Kural 1 (saf): beyan ile partinin en büyük ölçümünden faturalanan metre. */
export function decideBilledMeters(declared: D | number | null, measuredMax: D | number | null): BilledDecision {
  const dec = declared === null ? null : new Prisma.Decimal(declared);
  const mea = measuredMax === null ? null : new Prisma.Decimal(measuredMax);
  if (dec === null || dec.lte(0)) {
    return { billedM: num(mea), billedBasis: mea ? "MEASURED" : null, diffM: null, diffPct: null, withinTolerance: false, longerThanDeclared: false };
  }
  if (mea === null) return { billedM: num(dec), billedBasis: "DECLARED", diffM: null, diffPct: null, withinTolerance: false, longerThanDeclared: false };
  const diff = mea.minus(dec);
  const pct = diff.div(dec).mul(100);
  const within = pct.abs().lt(METER_COMPARE_TOLERANCE_PCT);
  const longer = diff.gt(0) && !within;
  return {
    billedM: num(longer ? mea : dec), billedBasis: longer ? "MEASURED" : "DECLARED",
    diffM: num(diff), diffPct: Number(pct.toFixed(2)), withinTolerance: within, longerThanDeclared: longer,
  };
}

interface RollNode {
  id: string;
  parentRollId: string | null;
  batchId: string | null;
  initialQty: D;
  status: RollStatus;
  barcode: string | null;
  entrySource: string;
  createdAt: Date;
}
const ROLL_NODE_SELECT = { id: true, parentRollId: true, batchId: true, initialQty: true, status: true, barcode: true, entrySource: true, createdAt: true } as const;

export interface DefectBeyondDeclared { rollId: string; barcode: string | null; startMeter: number; rollDeclaredM: number }

export interface PartyMeters extends BilledDecision {
  partyKey: string;
  batchNo: string | null;
  declaredM: number | null;
  declaredSource: DeclaredSource | null;
  kursunOutM: number | null;
  tamburInM: number | null;
  tamburCutM: number | null;
  measuredMaxM: number | null;
  defectsBeyondDeclared: DefectBeyondDeclared[];
  /** İç alanlar (uçlara girmez): partinin kökleri ve bütün topları. */
  rootIds: string[];
  rollIds: string[];
  firstAt: Date;
}

export interface PartyResolution {
  parties: PartyMeters[];
  /** Top → parti anahtarı (soy dahil). */
  partyOfRoll: Map<string, string>;
}

/** Verilen toplar + bütün ataları (zincir başına ≤32 kuşak). */
async function loadUp(ids: string[], db: Db, into: Map<string, RollNode>): Promise<void> {
  let frontier = [...new Set(ids)].filter((id) => !into.has(id));
  for (let d = 0; d < 32 && frontier.length > 0; d++) {
    const rows = await db.roll.findMany({ where: { id: { in: frontier } }, select: ROLL_NODE_SELECT });
    for (const r of rows) into.set(r.id, r);
    frontier = [...new Set(rows.map((r) => r.parentRollId).filter((p): p is string => p !== null && !into.has(p)))];
  }
}

/** Köklerin bütün torunları (≤32 kuşak). */
async function loadDown(rootIds: string[], db: Db, into: Map<string, RollNode>): Promise<void> {
  let frontier = [...new Set(rootIds)];
  const seen = new Set(frontier);
  for (let d = 0; d < 32 && frontier.length > 0; d++) {
    const rows = await db.roll.findMany({ where: { parentRollId: { in: frontier } }, select: ROLL_NODE_SELECT });
    frontier = [];
    for (const r of rows) {
      into.set(r.id, r);
      if (!seen.has(r.id)) { seen.add(r.id); frontier.push(r.id); }
    }
  }
}

function rootOf(id: string, nodes: Map<string, RollNode>): string {
  let cur = id;
  for (let d = 0; d < 33; d++) {
    const p = nodes.get(cur)?.parentRollId;
    if (!p || !nodes.has(p)) break;
    cur = p;
  }
  return cur;
}

/** Ata zincirinde değeri olan top varsa çocuğun değeri sayılmaz (aynı kumaş iki kez ölçülmüş sayılmasın). */
function frontierSum(values: Map<string, D>, nodes: Map<string, RollNode>): D | null {
  if (values.size === 0) return null;
  let sum = D0();
  for (const [id, v] of values) {
    let covered = false;
    for (let p = nodes.get(id)?.parentRollId ?? null, d = 0; p && d < 32; p = nodes.get(p)?.parentRollId ?? null, d++) {
      if (values.has(p)) { covered = true; break; }
    }
    if (!covered) sum = sum.plus(v);
  }
  return sum;
}

/** Kural 4 uyarı metni — tablet sarı şerit; bekçi aynı cümleyi arar. */
export function beyondDeclaredDefectWarning(startMeter: number, declaredM: number): string {
  return `Hata konumu (${startMeter} m) topun beyan metresini (${declaredM} m) aşıyor — kayıt alındı, metre farkı iş emrinde görünür.`;
}

type DeclaredBlock = { blockNo?: number; m?: number | string | null };

/** Topun KENDİ beyanı: ona bağlı gelen belge satırının metresi (top ya da parti satırı) → doğuş metresi. */
export async function rollDeclaredMeters(rollIds: string[], db: Db = prisma): Promise<Map<string, D>> {
  const ids = [...new Set(rollIds)];
  const out = new Map<string, D>();
  if (ids.length === 0) return out;
  const [lines, rolls] = [
    await db.customerDeliveryNoteLine.findMany({ where: { rollId: { in: ids } }, select: { rollId: true, meters: true } }),
    await db.roll.findMany({ where: { id: { in: ids } }, select: { id: true, initialQty: true } }),
  ];
  for (const r of rolls) out.set(r.id, r.initialQty);
  for (const l of lines) if (l.rollId && l.meters.gt(0)) out.set(l.rollId, l.meters);
  return out;
}

/**
 * Verilen topların partileri (soy ve kardeş kökler dahil, sevkten bağımsız) ve parti başına beyan / ölçüm / faturalanan.
 * Fatura (`MAX_DECLARED`), İE karşılaştırması ve hata izi buradan okur.
 */
/** Parti yapısı: kökler (belge bloğu → belgesiz parti → kök), kardeş kökler ve bütün torunlar. */
async function loadPartyStructure(rollIds: string[], db: Db) {
  const nodes = new Map<string, RollNode>();
  await loadUp(rollIds, db, nodes);
  const seedRoots = [...new Set(rollIds.filter((id) => nodes.has(id)).map((id) => rootOf(id, nodes)))];
  if (seedRoots.length === 0) return null;

  // ① Kökün belge satırı → parti (not + blok); kardeş kökler aynı bloğun öteki satırları.
  const seedLines = await db.customerDeliveryNoteLine.findMany({ where: { rollId: { in: seedRoots } }, select: { rollId: true, noteId: true, blockNo: true } });
  const blockKeys = [...new Map(seedLines.map((l) => [`${l.noteId}:${l.blockNo}`, { noteId: l.noteId, blockNo: l.blockNo }])).values()];
  const blockLines = blockKeys.length === 0 ? [] : await db.customerDeliveryNoteLine.findMany({
    where: { OR: blockKeys.map((k) => ({ noteId: k.noteId, blockNo: k.blockNo })), rollId: { not: null } },
    select: { id: true, rollId: true, noteId: true, blockNo: true, meters: true, customerBatchNo: true },
  });
  const lineOfRoll = new Map(blockLines.map((l) => [l.rollId!, l]));
  // ② Belgesiz kök → partisi (`batchId`): partinin öteki belgesiz kökleri kardeştir.
  await loadUp(blockLines.map((l) => l.rollId!), db, nodes);
  const batchIds = [...new Set(seedRoots.filter((r) => !lineOfRoll.has(r)).map((r) => nodes.get(r)!.batchId).filter((b): b is string => b !== null))];
  const batchRoots = batchIds.length === 0 ? [] : await db.roll.findMany({ where: { batchId: { in: batchIds }, parentRollId: null }, select: ROLL_NODE_SELECT });
  for (const r of batchRoots) nodes.set(r.id, r);
  const batchRootLines = batchRoots.length === 0 ? [] : await db.customerDeliveryNoteLine.findMany({ where: { rollId: { in: batchRoots.map((r) => r.id) } }, select: { rollId: true } });
  const docked = new Set(batchRootLines.map((l) => l.rollId));

  const keyOfRoot = (rootId: string): string => {
    const line = lineOfRoll.get(rootId);
    if (line) return `N:${line.noteId}:${line.blockNo}`;
    const b = nodes.get(rootId)?.batchId;
    return b ? `B:${b}` : `R:${rootId}`;
  };
  const allRoots = new Set<string>([...seedRoots, ...blockLines.map((l) => rootOf(l.rollId!, nodes)), ...batchRoots.filter((r) => !docked.has(r.id)).map((r) => r.id)]);
  const rootsByParty = new Map<string, string[]>();
  for (const r of allRoots) rootsByParty.set(keyOfRoot(r), [...(rootsByParty.get(keyOfRoot(r)) ?? []), r]);
  await loadDown([...allRoots], db, nodes);

  const partyOfRoll = new Map<string, string>();
  for (const id of nodes.keys()) {
    const root = rootOf(id, nodes);
    if (allRoots.has(root)) partyOfRoll.set(id, keyOfRoot(root));
  }
  return { nodes, blockKeys, blockLines, lineOfRoll, allRoots, rootsByParty, partyOfRoll };
}

/** Ölçümler top başına (en son): kurşun istasyonu OUT · kesim CUT (SIMULATED hariç) · tambur giriş hareketi. */
async function loadMeasurements(ids: string[], db: Db) {
  const readings = ids.length === 0 ? [] : await db.rollMeterReading.findMany({
    where: { rollId: { in: ids }, revokedAt: null, source: { not: MachineDataSource.SIMULATED }, phase: { in: [MeterPhase.OUT, MeterPhase.CUT] } },
    select: { rollId: true, phase: true, meters: true, step: { select: { station: { select: { propertyCapabilities: { where: { property: { code: KURSUN_PROPERTY_CODE } }, select: { stationId: true }, take: 1 } } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const kursunOf = new Map<string, D>();
  const cutOf = new Map<string, D>();
  for (const r of readings) {
    if (r.phase === MeterPhase.CUT) cutOf.set(r.rollId, r.meters);
    else if (r.step.station.propertyCapabilities.length > 0) kursunOf.set(r.rollId, r.meters);
  }
  const tamburMoves = ids.length === 0 ? [] : await db.rollMovement.findMany({
    where: { ...ACTIVE_MOVEMENT, rollId: { in: ids }, step: { station: { kind: StationKind.TAMBUR } } },
    select: { rollId: true, qtyIn: true },
    orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
  });
  const tamburInOf = new Map<string, D>();
  for (const m of tamburMoves) tamburInOf.set(m.rollId, m.qtyIn);

  return { kursunOf, cutOf, tamburInOf };
}

export async function resolvePartyMeters(rollIds: string[], db: Db = prisma): Promise<PartyResolution> {
  const st = await loadPartyStructure(rollIds, db);
  if (!st) return { parties: [], partyOfRoll: new Map() };
  const { nodes, blockKeys, blockLines, lineOfRoll, allRoots, rootsByParty, partyOfRoll } = st;
  const ids = [...partyOfRoll.keys()];

  // Beyan girdileri.
  const noteIds = [...new Set(blockKeys.map((k) => k.noteId))];
  const notes = noteIds.length === 0 ? [] : await db.customerDeliveryNote.findMany({ where: { id: { in: noteIds } }, select: { id: true, totalsDeclared: true } });
  const totalsOf = new Map(notes.map((n) => [n.id, n.totalsDeclared as { blocks?: DeclaredBlock[] } | null]));
  const firstMoves = await db.rollMovement.findMany({
    where: { ...ACTIVE_MOVEMENT, rollId: { in: [...allRoots] } },
    select: { rollId: true, qtyIn: true, enteredAt: true },
    orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
  });
  const firstQtyIn = new Map<string, D>();
  for (const m of firstMoves) if (!firstQtyIn.has(m.rollId)) firstQtyIn.set(m.rollId, m.qtyIn);

  const { kursunOf, cutOf, tamburInOf } = await loadMeasurements(ids, db);
  const ownDeclared = await rollDeclaredMeters(ids, db);
  const defects = ids.length === 0 ? [] : await db.rollError.findMany({
    where: { ...ACTIONABLE_ROLL_ERROR_WHERE, rollId: { in: ids }, startMeter: { not: null } },
    select: { rollId: true, startMeter: true },
    orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
  });

  const parties: PartyMeters[] = [];
  for (const [partyKey, roots] of rootsByParty) {
    const members = ids.filter((id) => partyOfRoll.get(id) === partyKey);
    const pick = (m: Map<string, D>) => new Map([...m].filter(([id]) => partyOfRoll.get(id) === partyKey));
    const liveRoots = roots.filter((r) => nodes.get(r)!.status !== RollStatus.CANCELLED);
    let declared: D | null = null;
    let declaredSource: DeclaredSource | null = null;
    const n = partyKey.startsWith("N:") ? lineOfRoll.get(roots.find((r) => lineOfRoll.has(r))!) : undefined;
    if (n) {
      const summary = blockLines.find((l) => l.id === partyLineId(n.noteId, n.blockNo));
      const printed = (totalsOf.get(n.noteId)?.blocks ?? []).find((b) => (b.blockNo ?? 1) === n.blockNo)?.m;
      const printedNum = printed === null || printed === undefined || printed === "" ? NaN : Number(printed);
      if (summary && summary.meters.gt(0)) declared = summary.meters;
      else if (Number.isFinite(printedNum) && printedNum > 0) declared = new Prisma.Decimal(printedNum);
      if (declared) declaredSource = "DOCUMENT";
    }
    if (!declared && liveRoots.length > 0 && liveRoots.every((r) => firstQtyIn.has(r))) {
      const s = liveRoots.reduce((a, r) => a.plus(firstQtyIn.get(r)!), D0());
      if (s.gt(0)) { declared = s; declaredSource = "WORK_ORDER"; }
    }
    if (!declared) {
      const s = liveRoots.reduce((a, r) => a.plus(nodes.get(r)!.initialQty), D0());
      if (s.gt(0)) { declared = s; declaredSource = "ROLL_INITIAL"; }
    }
    const kursun = frontierSum(pick(kursunOf), nodes);
    const cut = frontierSum(pick(cutOf), nodes);
    const tamburIn = frontierSum(pick(tamburInOf), nodes);
    const measured = [kursun, cut].filter((v): v is D => v !== null).reduce<D | null>((a, v) => (a === null || v.gt(a) ? v : a), null);
    const batchNo = blockLines.find((l) => partyOfRoll.get(l.rollId!) === partyKey && l.customerBatchNo?.trim())?.customerBatchNo?.trim() ?? null;
    const defectsBeyondDeclared = defects
      .filter((e) => partyOfRoll.get(e.rollId) === partyKey && ownDeclared.has(e.rollId) && e.startMeter!.gt(ownDeclared.get(e.rollId)!))
      .map((e) => ({ rollId: e.rollId, barcode: nodes.get(e.rollId)?.barcode ?? null, startMeter: Number(e.startMeter), rollDeclaredM: Number(ownDeclared.get(e.rollId)!.toFixed(3)) }));
    parties.push({
      partyKey, batchNo, declaredM: num(declared), declaredSource,
      kursunOutM: num(kursun), tamburInM: num(tamburIn), tamburCutM: num(cut), measuredMaxM: num(measured),
      ...decideBilledMeters(declared, measured),
      defectsBeyondDeclared, rootIds: roots, rollIds: members,
      firstAt: roots.reduce((a, r) => (nodes.get(r)!.createdAt < a ? nodes.get(r)!.createdAt : a), nodes.get(roots[0]!)!.createdAt),
    });
  }
  parties.sort((a, b) => a.firstAt.getTime() - b.firstAt.getTime() || a.partyKey.localeCompare(b.partyKey));
  return { parties, partyOfRoll };
}
