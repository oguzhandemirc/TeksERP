// =============================================================================
// ADIM HİZMET İŞLERİ — süreç türü eşlemeli adım (genel fason F3, PLAN-genel-fason §4a)
// =============================================================================
// Soru: "bu toplar kurşun ve bayrak DIŞINDA hangi süreçten geçti (boya, apre, çözgü…), hangi
// hizmet kartıyla, kaç metre?" Adımın süreç türü (`requiredCategoryId`, yoksa istasyonun
// `defaultCategoryId`) `service_item_processes`te bir karta eşliyse adım hizmet işidir.
// Ne zaman sayılır:
//   • İÇ adım (istasyon INTERNAL): topun o adımdaki aktif hareketi KAPANMIŞ (`exitedAt`), adım ATLANMAMIŞ.
//     Metre: adımın aktif, SIMULATED olmayan okuması (OUT tabanında OUT → IN) → hareket `qtyOut`
//     (DECLARED) → mevcut metre (DECLARED). Adımın yalnız SIMULATED okuması varsa iş GİRMEZ (çekirdek,
//     ayar değil) — çağıran uyarır.
//   • DIŞ adım (EXTERNAL): yalnız iptal edilmemiş fason kabulünde — RECEIVED (doğan top kabul metresi;
//     makbuzdan kendisi dönen top: kalemlerin alınan metresi, NULL kalem topu bir kez sayar). Sevk tek
//     başına iş değildir.
// Öncelik TOP BAŞINADIR: aynı top (ya da soyundaki top) aynı adımda kurşun/bayrak işi verdiyse (`claimedWorks`)
// ya da adımsız bayrak işinin özelliğini bu adımın istasyonu verebiliyorsa (`flagClaims`) adım işi düşer;
// aynı sevkteki başka topun işi bastırmaz. Metresi 0 çıkan iş sessiz düşmez — sayılır, çağıran uyarır.
// Yalnız okur; `FinishingRate` (bizim ödediğimiz maliyet) burada da okunmaz.
// =============================================================================
import { MachineDataSource, MeterPhase, Prisma, StationType, StepStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export type StepWorkBasis = "OUT" | "IN" | "DECLARED" | "RECEIVED";

export interface StepWork {
  rollId: string;
  workOrderStepId: string;
  categoryId: string;
  categoryName: string;
  serviceItemId: string;
  meters: Prisma.Decimal;
  meterBasis: StepWorkBasis;
  readingId: string | null;
  serviceAt: Date;
}

export interface StepWorkList {
  works: StepWork[];
  /** Adımın yalnız simüle okuması olan işler (top × adım) — faturaya girmez, çağıran uyarır. */
  simulatedCount: number;
  /** Metre kaynağı 0 kalan işler (top × adım) — faturaya girmez, çağıran uyarır. */
  zeroMeterCount: number;
}

/** Adımın süreç türü: planlanan tür, yoksa istasyonun varsayılan türü. */
function stepCategoryOf(step: { requiredCategoryId: string | null; station: { defaultCategoryId: string | null } }): string | null {
  return step.requiredCategoryId !== null ? step.requiredCategoryId : step.station.defaultCategoryId;
}

/** Eşlemeli süreç türleri: kategori → { kart, ad }. Pasif tür de sayılır (eşleme yaşıyorsa faturalar — fail-closed). */
async function loadProcessMap(db: Db): Promise<Map<string, { serviceItemId: string; name: string }>> {
  const rows = await db.serviceItemProcess.findMany({ select: { categoryId: true, serviceItemId: true, category: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.categoryId, { serviceItemId: r.serviceItemId, name: r.category.name }]));
}

type Mapped = { categoryId: string; categoryName: string; serviceItemId: string };
type StepRef = { id: string; stationId: string; requiredCategoryId: string | null; station: { defaultCategoryId: string | null } };
type RollRow = { id: string; parentRollId: string | null; parentReceiptId: string | null; initialQty: Prisma.Decimal; currentQty: Prisma.Decimal };

const STEP_SELECT = { id: true, stationId: true, requiredCategoryId: true, station: { select: { type: true, defaultCategoryId: true } } } as const;

/**
 * Bayrak/kurşun önceliği (top başına): aynı adımda iş veren top bu topla aynı soydaysa (kendisi, atası ya da
 * çocuğu) ya da adımsız bayrak işinin özelliğini adımın istasyonu verebiliyor ve bayraklı top bu topun soyundaysa düşer.
 */
async function buildClaimed(
  db: Db, byId: Map<string, RollRow>, stationIds: string[],
  claims: { claimedWorks: Array<{ rollId: string; workOrderStepId: string }>; flagClaims: Array<{ rollId: string; propertyId: string }> },
): Promise<(rollId: string, step: { id: string; stationId: string }) => boolean> {
  const { claimedWorks, flagClaims } = claims;
  const stationProps = new Map<string, Set<string>>();
  if (flagClaims.length > 0 && stationIds.length > 0) {
    for (const sp of await db.stationProperty.findMany({ where: { stationId: { in: stationIds } }, select: { stationId: true, propertyId: true } })) {
      stationProps.set(sp.stationId, (stationProps.get(sp.stationId) ?? new Set()).add(sp.propertyId));
    }
  }
  const descendsFrom = (rid: string, ancestor: string): boolean => {
    for (let cur: string | null = rid, d = 0; cur && d < 32; cur = byId.get(cur)?.parentRollId ?? null, d++) if (cur === ancestor) return true;
    return false;
  };
  return (rollId, step) => {
    if (claimedWorks.some((c) => c.workOrderStepId === step.id && (descendsFrom(c.rollId, rollId) || descendsFrom(rollId, c.rollId)))) return true;
    const props = stationProps.get(step.stationId);
    return !!props && flagClaims.some((f) => props.has(f.propertyId) && descendsFrom(f.rollId, rollId));
  };
}

/** İç adım işleri: kapanmış aktif hareket; metre gerçek okuma → qtyOut → mevcut metre; yalnız SIMULATED → sayılır, girmez. */
async function internalWorks(
  db: Db, ctx: { rollIds: string[]; basis: "OUT" | "IN" | "DECLARED"; byId: Map<string, RollRow>; mappedStep: Prisma.WorkOrderStepWhereInput },
): Promise<{ moves: Array<{ rollId: string; workOrderStepId: string; qtyIn: Prisma.Decimal; qtyOut: Prisma.Decimal | null; exitedAt: Date | null; step: StepRef }>; build: (mapped: (s: StepRef) => Mapped | null, claimed: (r: string, s: StepRef) => boolean) => { works: StepWork[]; simulated: number; zero: number } }> {
  const moves = await db.rollMovement.findMany({
    where: { rollId: { in: ctx.rollIds }, ...ACTIVE_MOVEMENT, exitedAt: { not: null }, step: { ...ctx.mappedStep, station: { type: StationType.INTERNAL } } },
    select: { id: true, rollId: true, workOrderStepId: true, qtyIn: true, qtyOut: true, exitedAt: true, step: { select: STEP_SELECT } },
    orderBy: [{ exitedAt: "asc" }, { id: "asc" }],
  });
  const stepIds = [...new Set(moves.map((m) => m.workOrderStepId))];
  const phases = ctx.basis === "OUT" ? [MeterPhase.OUT, MeterPhase.IN] : ctx.basis === "IN" ? [MeterPhase.IN] : [];
  const readings = stepIds.length === 0 ? [] : await db.rollMeterReading.findMany({
    where: { rollId: { in: ctx.rollIds }, workOrderStepId: { in: stepIds }, revokedAt: null },
    select: { id: true, rollId: true, workOrderStepId: true, phase: true, meters: true, source: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const build = (mapped: (s: StepRef) => Mapped | null, claimed: (r: string, s: StepRef) => boolean) => {
    const works = new Map<string, StepWork>();
    const simulated = new Set<string>();
    const zero = new Set<string>();
    const readingsByKey = new Map<string, typeof readings>();
    for (const r of readings) readingsByKey.set(`${r.rollId}:${r.workOrderStepId}`, [...(readingsByKey.get(`${r.rollId}:${r.workOrderStepId}`) ?? []), r]);
    for (const m of moves) {
      const map = mapped(m.step);
      if (!map || claimed(m.rollId, m.step)) continue;
      const key = `${m.rollId}:${m.workOrderStepId}`;
      const mine = readingsByKey.get(key) ?? [];
      const real = mine.filter((r) => r.source !== MachineDataSource.SIMULATED);
      if (mine.length > 0 && real.length === 0) { works.delete(key); simulated.add(key); continue; }
      let hit: (typeof real)[number] | undefined;
      for (const phase of phases) { hit = real.filter((r) => r.phase === phase).at(-1); if (hit) break; }
      // Okumasız: çıkış metresi → mevcut metre → giriş metresi (bölünmüş ana topun mevcut metresi 0'dır).
      const current = ctx.byId.get(m.rollId)!.currentQty;
      const meters = hit ? hit.meters : m.qtyOut ?? (current.gt(0) ? current : m.qtyIn);
      if (meters.lte(0)) { if (!works.has(key)) zero.add(key); continue; }
      zero.delete(key);
      works.set(key, {
        rollId: m.rollId, workOrderStepId: m.workOrderStepId, ...map, meters,
        meterBasis: hit ? (hit.phase === MeterPhase.OUT ? "OUT" : "IN") : "DECLARED",
        readingId: hit?.id ?? null, serviceAt: hit ? hit.createdAt : m.exitedAt!,
      });
    }
    return { works: [...works.values()], simulated: simulated.size, zero: zero.size };
  };
  return { moves, build };
}

/** Dış adım işleri: yalnız iptal edilmemiş kabul — doğan top (kabul metresi) ya da makbuzdan kendisi dönen top. */
async function externalWorks(
  db: Db, ctx: { rollIds: string[]; rolls: RollRow[]; mappedStep: Prisma.WorkOrderStepWhereInput },
): Promise<{ stationIds: string[]; build: (mapped: (s: StepRef) => Mapped | null, claimed: (r: string, s: StepRef) => boolean) => { works: StepWork[]; zero: number } }> {
  const externalStep = { ...ctx.mappedStep, station: { type: StationType.EXTERNAL } };
  const receiptIds = [...new Set(ctx.rolls.map((r) => r.parentReceiptId).filter((v): v is string => v !== null))];
  const born = receiptIds.length === 0 ? [] : await db.subcontractorReceipt.findMany({
    where: { id: { in: receiptIds }, cancelledAt: null, step: externalStep },
    select: { id: true, receivedAt: true, step: { select: STEP_SELECT } },
  });
  const selfReturns = await db.subcontractorReceiptItem.findMany({
    where: { newRollId: { in: ctx.rollIds }, receipt: { cancelledAt: null, bornRolls: { none: {} }, step: externalStep } },
    select: { newRollId: true, receivedQty: true, receipt: { select: { receivedAt: true, step: { select: STEP_SELECT } } } },
    orderBy: [{ receipt: { receivedAt: "asc" } }, { id: "asc" }],
  });
  const stationIds = [...born.map((b) => b.step!.stationId), ...selfReturns.map((s) => s.receipt.step!.stationId)];
  const build = (mapped: (s: StepRef) => Mapped | null, claimed: (r: string, s: StepRef) => boolean): { works: StepWork[]; zero: number } => {
    const out: StepWork[] = [];
    let zero = 0;
    const rollById = new Map(ctx.rolls.map((r) => [r.id, r]));
    const bornById = new Map(born.map((b) => [b.id, b]));
    for (const roll of ctx.rolls) {
      const rc = roll.parentReceiptId ? bornById.get(roll.parentReceiptId) : undefined;
      const map = rc?.step ? mapped(rc.step) : null;
      if (!rc?.step || !map || claimed(roll.id, rc.step)) continue;
      // Eski açık-kumaş yolunda initialQty 0 kalabilir.
      const meters = roll.initialQty.gt(0) ? roll.initialQty : roll.currentQty;
      if (meters.lte(0)) { zero++; continue; }
      out.push({ rollId: roll.id, workOrderStepId: rc.step.id, ...map, meters, meterBasis: "RECEIVED", readingId: null, serviceAt: rc.receivedAt });
    }
    const byKey = new Map<string, typeof selfReturns>();
    for (const s of selfReturns) byKey.set(`${s.newRollId}:${s.receipt.step!.id}`, [...(byKey.get(`${s.newRollId}:${s.receipt.step!.id}`) ?? []), s]);
    for (const group of byKey.values()) {
      const first = group[0]!;
      const step = first.receipt.step!;
      const map = mapped(step);
      if (!first.newRollId || !map || claimed(first.newRollId, step)) continue;
      const roll = rollById.get(first.newRollId)!;
      // NULL receivedQty = eski kalem ("tamamı kabul edildi") → topun kendisi BİR kez.
      const explicit = group.reduce((a, i) => (i.receivedQty ? a.plus(i.receivedQty) : a), new Prisma.Decimal(0));
      // NULL kalemde top sonradan bölündüyse mevcut metre 0 olur → ilk metre.
      const whole = roll.currentQty.gt(0) ? roll.currentQty : roll.initialQty;
      const meters = group.some((i) => i.receivedQty === null) ? explicit.plus(whole) : explicit;
      if (meters.lte(0)) { zero++; continue; }
      out.push({ rollId: roll.id, workOrderStepId: step.id, ...map, meters, meterBasis: "RECEIVED", readingId: null, serviceAt: first.receipt.receivedAt });
    }
    return { works: out, zero };
  };
  return { stationIds, build };
}

/**
 * Verilen toplardaki adım işleri. `basis` H7 metre tabanıdır (DECLARED okumayı kapatır).
 * `claimedWorks`: kurşun/bayrak işleri (top + adım) · `flagClaims`: adımsız bayrak işleri (top + özellik).
 */
export async function listStepServiceWorks(
  rollIds: string[],
  basis: "OUT" | "IN" | "DECLARED",
  opts: { db?: Db; claimedWorks?: Array<{ rollId: string; workOrderStepId: string }>; flagClaims?: Array<{ rollId: string; propertyId: string }> } = {},
): Promise<StepWorkList> {
  const db = opts.db ?? prisma;
  const none: StepWorkList = { works: [], simulatedCount: 0, zeroMeterCount: 0 };
  if (rollIds.length === 0) return none;
  const processMap = await loadProcessMap(db);
  if (processMap.size === 0) return none;
  const categoryIds = [...processMap.keys()];
  const mappedStep: Prisma.WorkOrderStepWhereInput = {
    status: { not: StepStatus.SKIPPED },
    OR: [{ requiredCategoryId: { in: categoryIds } }, { requiredCategoryId: null, station: { defaultCategoryId: { in: categoryIds } } }],
  };
  const rolls = await db.roll.findMany({
    where: { id: { in: rollIds } },
    select: { id: true, parentRollId: true, parentReceiptId: true, initialQty: true, currentQty: true },
  });
  const byId = new Map(rolls.map((r) => [r.id, r]));
  const internal = await internalWorks(db, { rollIds, basis, byId, mappedStep });
  const external = await externalWorks(db, { rollIds, rolls, mappedStep });
  const stationIds = [...new Set([...internal.moves.map((m) => m.step.stationId), ...external.stationIds])];
  const claimed = await buildClaimed(db, byId, stationIds, { claimedWorks: opts.claimedWorks ?? [], flagClaims: opts.flagClaims ?? [] });
  const mapped = (step: StepRef): Mapped | null => {
    const categoryId = stepCategoryOf(step);
    const hit = categoryId ? processMap.get(categoryId) : undefined;
    return categoryId && hit ? { categoryId, categoryName: hit.name, serviceItemId: hit.serviceItemId } : null;
  };
  const inner = internal.build(mapped, claimed);
  // Anahtar top:adım — dış iş aynı anahtarda içi ezer (önceki Map davranışı).
  const all = new Map<string, StepWork>();
  const outer = external.build(mapped, claimed);
  for (const w of [...inner.works, ...outer.works]) all.set(`${w.rollId}:${w.workOrderStepId}`, w);
  return { works: [...all.values()], simulatedCount: inner.simulated, zeroMeterCount: inner.zero + outer.zero };
}
