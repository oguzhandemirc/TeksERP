// =============================================================================
// BAYRAK TİPİ HİZMET İŞLERİ — Tambur · etek kesim · brode (Gülkesim dalga 2 · H10, karar belgesi §5)
// =============================================================================
// Soru: "bu topa kurşun DIŞINDA hangi faturalanacak iş yapıldı, kaç metre?"
// İşin izi topun AKTİF BAYRAK özelliğidir (`RollProperty`; kesimde `inheritRollPropertiesTx`
// ile çocuğa geçer); kalem `FabricProperty.serviceItemId`ten. Kurşun bayrağı ve çeşidi
// (gramaj) olan bayraklar BURADA OKUNMAZ — onlar `listKursunApplications` yolundadır.
// Metre sırası (ilk bulunan; iş, metrenin ölçüldüğü topa bağlanır):
//   ① özelliği verebilen istasyondaki adımın aktif okuması (iç brode) — topta ya da atasında
//   ② top o istasyonun (iptal edilmemiş) fason makbuzundan doğduysa (`parentReceiptId`) doğan
//      topun kabul metresi (dış brode) — RECEIVED; kısmi kabullerde her doğan top kendi metresiyle.
//      Makbuzdan KENDİSİ dönen top (doğan top yok; eski model): makbuz kaleminin alınan metresi (F1); NULL kalem(ler) topu bir kez sayar
//   ③ top Tambur bölmesiyle doğduysa kesilen metre — CUT, çocuk topta: aktif CUT okuması varsa onun metresi + `readingId`
//      (D4-B2); okuma SIMULATED ise iş listeye GİRMEZ (K4, çekirdek — `simulatedCutRollIds`); okumasız (eski) top `initialQty`
//   ④ yoksa topun mevcut metresi — DECLARED (uyarı ayarı H7 `missingMeter`)
// Kümede çocuğu olan top ataysa iş taşımaz; ama kendisi de sevk edilen (çağıranın `shippedRollIds`i) canlı ata
// kalan parçasını kendisi taşır (F1: ata + çocuk aynı sevkte/dönemde atanın kalanı düşmesin).
// Atadaki ①/② kardeş parça aynı kalemle parça parça (CUT/DECLARED) faturalandıysa okunmaz — ata işi
// bütünüyle ikinci kez kesilmesin; çocuk ③/④ ile kendi parçasını taşır.
// Yalnız okur. `FinishingRate` (bizim ödediğimiz maliyet) burada da okunmaz.
// =============================================================================
import { MachineDataSource, MeterPhase, Prisma, RollEntrySource, ServiceMeterBasis } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;
import { ACTIVE_ROLL_PROPERTY } from "./property-revoke.helper";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";

export type FlagWorkBasis = "OUT" | "IN" | "DECLARED" | "CUT" | "RECEIVED";

export interface FlagWork {
  rollId: string;
  workOrderStepId: string | null;
  propertyId: string;
  propertyName: string;
  serviceItemId: string;
  meters: Prisma.Decimal;
  meterBasis: FlagWorkBasis;
  readingId: string | null;
  /** D4-G2a: işi ölçen okumanın makinesi (kârlılık makine kırılımı); okumasız (RECEIVED/DECLARED/eski CUT) iş `null`. */
  machineId: string | null;
  serviceAt: Date;
}

type RollRow = {
  id: string;
  parentRollId: string | null;
  parentReceiptId: string | null;
  entrySource: RollEntrySource | null;
  initialQty: Prisma.Decimal;
  currentQty: Prisma.Decimal;
  producedInStepId: string | null;
  createdAt: Date;
};

/**
 * ② TEK çözücü (RECEIVED) kurucusu: doğan top (`parentReceiptId`) → kabul metresi; makbuzdan KENDİSİ dönen top (makbuz
 * kalemi topun kendisi, makbuzdan doğan top yok — eski "yerinde dönüş" modeli) → aynı adımın kalemlerinde alınan metre.
 */
async function loadReceivedResolver(byId: Map<string, RollRow>, allStations: string[], db: Db) {
  const rolls = [...byId.values()];
  const chainIds = [...byId.keys()];
  const receiptIds = [...new Set(rolls.map((r) => r.parentReceiptId).filter((v): v is string => v !== null))];
  const receipts = allStations.length === 0 || receiptIds.length === 0 ? [] : await db.subcontractorReceipt.findMany({
    where: { id: { in: receiptIds }, cancelledAt: null, step: { stationId: { in: allStations } } },
    select: { id: true, stepId: true, receivedAt: true, step: { select: { stationId: true } } },
  });
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  // Makbuzdan KENDİSİ dönen top: makbuz kalemi topun kendisi, makbuzdan doğan top yok (eski "yerinde dönüş" modeli).
  const selfReturns = allStations.length === 0 ? [] : await db.subcontractorReceiptItem.findMany({
    where: { newRollId: { in: chainIds }, receipt: { cancelledAt: null, step: { stationId: { in: allStations } }, bornRolls: { none: {} } } },
    select: { newRollId: true, receivedQty: true, receipt: { select: { stepId: true, receivedAt: true, step: { select: { stationId: true } } } } },
    orderBy: [{ receipt: { receivedAt: "asc" } }, { id: "asc" }],
  });
  /** ② TEK çözücü (RECEIVED): doğan top → kabul metresi; kendisi dönen top → aynı adımın kalemlerinde alınan metre. */
  const receivedOf = (rid: string, stations: Set<string>): { stepId: string | null; meters: Prisma.Decimal; at: Date } | null => {
    const row = byId.get(rid)!;
    const rc = row.parentReceiptId ? receiptById.get(row.parentReceiptId) : undefined;
    // Eski açık-kumaş yolunda initialQty 0 kalabilir.
    if (rc?.step && stations.has(rc.step.stationId)) return { stepId: rc.stepId, meters: row.initialQty.gt(0) ? row.initialQty : row.currentQty, at: rc.receivedAt };
    const own = selfReturns.filter((i) => i.newRollId === rid && i.receipt.step && stations.has(i.receipt.step.stationId));
    if (own.length === 0) return null;
    const same = own.filter((i) => i.receipt.stepId === own[0]!.receipt.stepId);
    // NULL receivedQty = 2026-08-19 öncesi kalem ("tamamı kabul edildi") → topun kendisi BİR kez (K3b: iki NULL kalem
    // aynı kumaşı iki kez saymaz); açık metreli kalemler kendi metresiyle toplanır.
    const explicit = same.reduce((a, i) => (i.receivedQty ? a.plus(i.receivedQty) : a), new Prisma.Decimal(0));
    const meters = same.some((i) => i.receivedQty === null) ? explicit.plus(row.currentQty) : explicit;
    return { stepId: own[0]!.receipt.stepId, meters, at: own[0]!.receipt.receivedAt };
  };
  return receivedOf;
}

/** ③ CUT okuması (D4-B2): H7 metre tabanından BAĞIMSIZ okunur — SIMULATED dışlaması çekirdektir (K4), ayar değil. */
async function loadActiveCutReadings(leaves: RollRow[], db: Db) {
  const ids = leaves.filter((r) => r.entrySource === RollEntrySource.TAMBUR_SPLIT && r.parentRollId).map((r) => r.id);
  const rows = ids.length === 0 ? [] : await db.rollMeterReading.findMany({
    where: { rollId: { in: ids }, phase: MeterPhase.CUT, revokedAt: null },
    select: { id: true, rollId: true, meters: true, source: true, machineId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return new Map(rows.map((r) => [r.rollId, r]));
}

/**
 * Verilen toplardaki bayrak tipi işler. Kümede çocuğu bulunan top (ata) iş TAŞIMAZ:
 * işi çocuk taşır, atanın ölçümü ancak ①/② ile (tamamı, bir kez) faturalanır.
 * `meterBasis` H7 ayarıdır: DECLARED okuma zincirini kapatır, IN yalnız giriş okumasını sayar.
 */
export interface FlagWorkList {
  works: FlagWork[];
  /** K4: kesim metresi SIMULATED okumalı çocuklar — iş faturaya girmez, çağıran uyarır (süpervizör düzeltmesi). */
  simulatedCutRollIds: string[];
}

export async function listFlagServiceWorks(
  rollIds: string[],
  meterBasis: "OUT" | "IN" | "DECLARED",
  opts: { shippedRollIds?: Set<string>; db?: Db } = {},
): Promise<FlagWorkList> {
  const db = opts.db ?? prisma;
  const none: FlagWorkList = { works: [], simulatedCutRollIds: [] };
  if (rollIds.length === 0) return none;
  const rolls: RollRow[] = await db.roll.findMany({
    where: { id: { in: rollIds } },
    select: { id: true, parentRollId: true, parentReceiptId: true, entrySource: true, initialQty: true, currentQty: true, producedInStepId: true, createdAt: true },
  });
  const byId = new Map(rolls.map((r) => [r.id, r]));
  const parents = new Set(rolls.map((r) => r.parentRollId).filter((v): v is string => v !== null && byId.has(v)));
  const leaves = rolls.filter((r) => !parents.has(r.id) || opts.shippedRollIds?.has(r.id));
  if (leaves.length === 0) return none;

  const props = await db.rollProperty.findMany({
    where: {
      rollId: { in: leaves.map((r) => r.id) },
      ...ACTIVE_ROLL_PROPERTY,
      property: { valueType: "FLAG", serviceItemId: { not: null }, code: { not: KURSUN_PROPERTY_CODE } },
    },
    select: { rollId: true, propertyId: true, createdAt: true, property: { select: { name: true, serviceItemId: true } } },
    orderBy: [{ rollId: "asc" }, { propertyId: "asc" }],
  });
  if (props.length === 0) return none;

  const propertyIds = [...new Set(props.map((p) => p.propertyId))];
  const stationRows = await db.stationProperty.findMany({ where: { propertyId: { in: propertyIds } }, select: { stationId: true, propertyId: true } });
  const stationsOf = new Map<string, Set<string>>();
  for (const s of stationRows) stationsOf.set(s.propertyId, (stationsOf.get(s.propertyId) ?? new Set()).add(s.stationId));
  const allStations = [...new Set(stationRows.map((s) => s.stationId))];
  const chainIds = [...byId.keys()];

  const phases = meterBasis === "OUT" ? [MeterPhase.OUT, MeterPhase.IN] : meterBasis === "IN" ? [MeterPhase.IN] : [];
  const readings = phases.length === 0 || allStations.length === 0 ? [] : await db.rollMeterReading.findMany({
    where: { rollId: { in: chainIds }, revokedAt: null, source: { not: MachineDataSource.SIMULATED }, phase: { in: phases }, step: { stationId: { in: allStations } } },
    select: { id: true, rollId: true, workOrderStepId: true, phase: true, meters: true, machineId: true, createdAt: true, step: { select: { stationId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const receivedOf = await loadReceivedResolver(byId, allStations, db);
  const cutOf = await loadActiveCutReadings(leaves, db);
  const simulatedCut = new Set<string>();
  // Kardeşi aynı kalemle parça parça faturalanmış atalar: `${ataId}:${kalem}`.
  const pieceBilled = new Set((await db.serviceBillingLink.findMany({
    where: { revokedAt: null, meterBasis: { in: [ServiceMeterBasis.CUT, ServiceMeterBasis.DECLARED] }, roll: { parentRollId: { in: chainIds } } },
    select: { serviceItemId: true, roll: { select: { parentRollId: true } } },
  })).map((l) => `${l.roll.parentRollId}:${l.serviceItemId}`));

  /** Topun kendisi + kümedeki ataları, yakından uzağa. */
  const chainOf = (id: string): string[] => {
    const out: string[] = [];
    for (let cur: string | null = id, d = 0; cur && byId.has(cur) && d < 32; cur = byId.get(cur)!.parentRollId, d++) out.push(cur);
    return out;
  };

  const works = new Map<string, FlagWork>();
  for (const p of props) {
    const leaf = byId.get(p.rollId)!;
    const stations = stationsOf.get(p.propertyId) ?? new Set<string>();
    const base = { propertyId: p.propertyId, propertyName: p.property.name, serviceItemId: p.property.serviceItemId! };
    let work: FlagWork | null = null;
    for (const rid of chainOf(leaf.id)) {
      if (rid !== leaf.id && pieceBilled.has(`${rid}:${base.serviceItemId}`)) break;
      // ① okuma: seçilen faz sırasıyla (OUT tabanında OUT → IN), adımın en son aktif okuması.
      for (const phase of phases) {
        const hit = readings.filter((r) => r.rollId === rid && r.phase === phase && stations.has(r.step.stationId)).at(-1);
        if (hit) { work = { ...base, rollId: rid, workOrderStepId: hit.workOrderStepId, meters: hit.meters, meterBasis: phase, readingId: hit.id, machineId: hit.machineId, serviceAt: hit.createdAt }; break; }
      }
      if (work) break;
      // ② dış (fason) iş — RECEIVED (doğan top ya da kendisi dönen top).
      const rcv = receivedOf(rid, stations);
      if (rcv) {
        work = { ...base, rollId: rid, workOrderStepId: rcv.stepId, meters: rcv.meters, meterBasis: "RECEIVED", readingId: null, machineId: null, serviceAt: rcv.at };
        break;
      }
    }
    // Sevk edilen ata (kümede çocuğu var) ③'e girmez: kesilen metresi çocuklarını da içerir → ④ kalan (mevcut) metre.
    const cut = !work && leaf.entrySource === RollEntrySource.TAMBUR_SPLIT ? cutOf.get(leaf.id) : undefined;
    // Simüle kesim metresi faturalanmaz (K4) — kendisi de kesilmiş ata olsa bile ④'e (simüleden türeyen kalan) düşmez.
    if (cut?.source === MachineDataSource.SIMULATED) { simulatedCut.add(leaf.id); continue; }
    if (!work && leaf.entrySource === RollEntrySource.TAMBUR_SPLIT && leaf.parentRollId && !parents.has(leaf.id)) {
      // ③ kesim: iş çocuk topta, metre kesilen metre — okuma varsa okumadan.
      work = { ...base, rollId: leaf.id, workOrderStepId: leaf.producedInStepId, meters: cut ? cut.meters : leaf.initialQty, meterBasis: "CUT", readingId: cut?.id ?? null, machineId: cut?.machineId ?? null, serviceAt: leaf.createdAt };
    }
    work ??= { ...base, rollId: leaf.id, workOrderStepId: null, meters: leaf.currentQty, meterBasis: "DECLARED", readingId: null, machineId: null, serviceAt: p.createdAt };
    // Aynı ata işine iki çocuktan varılır — tek iş (bağ anahtarıyla aynı üçlü).
    works.set(`${work.rollId}:${work.serviceItemId}:${work.workOrderStepId ?? "-"}`, work);
  }
  return { works: [...works.values()], simulatedCutRollIds: [...simulatedCut] };
}
