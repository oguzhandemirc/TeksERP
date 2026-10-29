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
//      topun kabul metresi (dış brode) — RECEIVED; kısmi kabullerde her doğan top kendi metresiyle
//   ③ top Tambur bölmesiyle doğduysa kesilen metre (`initialQty`) — CUT, çocuk topta
//   ④ yoksa topun mevcut metresi — DECLARED (uyarı ayarı H7 `missingMeter`)
// Atadaki ①/② kardeş parça aynı kalemle parça parça (CUT/DECLARED) faturalandıysa okunmaz — ata işi
// bütünüyle ikinci kez kesilmesin; çocuk ③/④ ile kendi parçasını taşır.
// Yalnız okur. `FinishingRate` (bizim ödediğimiz maliyet) burada da okunmaz.
// =============================================================================
import { MachineDataSource, MeterPhase, Prisma, RollEntrySource, ServiceMeterBasis } from "@prisma/client";
import prisma from "../../lib/prisma";
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
 * Verilen toplardaki bayrak tipi işler. Kümede çocuğu bulunan top (ata) iş TAŞIMAZ:
 * işi çocuk taşır, atanın ölçümü ancak ①/② ile (tamamı, bir kez) faturalanır.
 * `meterBasis` H7 ayarıdır: DECLARED okuma zincirini kapatır, IN yalnız giriş okumasını sayar.
 */
export async function listFlagServiceWorks(rollIds: string[], meterBasis: "OUT" | "IN" | "DECLARED"): Promise<FlagWork[]> {
  if (rollIds.length === 0) return [];
  const rolls: RollRow[] = await prisma.roll.findMany({
    where: { id: { in: rollIds } },
    select: { id: true, parentRollId: true, parentReceiptId: true, entrySource: true, initialQty: true, currentQty: true, producedInStepId: true, createdAt: true },
  });
  const byId = new Map(rolls.map((r) => [r.id, r]));
  const parents = new Set(rolls.map((r) => r.parentRollId).filter((v): v is string => v !== null && byId.has(v)));
  const leaves = rolls.filter((r) => !parents.has(r.id));
  if (leaves.length === 0) return [];

  const props = await prisma.rollProperty.findMany({
    where: {
      rollId: { in: leaves.map((r) => r.id) },
      ...ACTIVE_ROLL_PROPERTY,
      property: { valueType: "FLAG", serviceItemId: { not: null }, code: { not: KURSUN_PROPERTY_CODE } },
    },
    select: { rollId: true, propertyId: true, createdAt: true, property: { select: { name: true, serviceItemId: true } } },
    orderBy: [{ rollId: "asc" }, { propertyId: "asc" }],
  });
  if (props.length === 0) return [];

  const propertyIds = [...new Set(props.map((p) => p.propertyId))];
  const stationRows = await prisma.stationProperty.findMany({ where: { propertyId: { in: propertyIds } }, select: { stationId: true, propertyId: true } });
  const stationsOf = new Map<string, Set<string>>();
  for (const s of stationRows) stationsOf.set(s.propertyId, (stationsOf.get(s.propertyId) ?? new Set()).add(s.stationId));
  const allStations = [...new Set(stationRows.map((s) => s.stationId))];
  const chainIds = [...byId.keys()];

  const phases = meterBasis === "OUT" ? [MeterPhase.OUT, MeterPhase.IN] : meterBasis === "IN" ? [MeterPhase.IN] : [];
  const readings = phases.length === 0 || allStations.length === 0 ? [] : await prisma.rollMeterReading.findMany({
    where: { rollId: { in: chainIds }, revokedAt: null, source: { not: MachineDataSource.SIMULATED }, phase: { in: phases }, step: { stationId: { in: allStations } } },
    select: { id: true, rollId: true, workOrderStepId: true, phase: true, meters: true, createdAt: true, step: { select: { stationId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const receiptIds = [...new Set(rolls.map((r) => r.parentReceiptId).filter((v): v is string => v !== null))];
  const receipts = allStations.length === 0 || receiptIds.length === 0 ? [] : await prisma.subcontractorReceipt.findMany({
    where: { id: { in: receiptIds }, cancelledAt: null, step: { stationId: { in: allStations } } },
    select: { id: true, stepId: true, receivedAt: true, step: { select: { stationId: true } } },
  });
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  // Kardeşi aynı kalemle parça parça faturalanmış atalar: `${ataId}:${kalem}`.
  const pieceBilled = new Set((await prisma.serviceBillingLink.findMany({
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
        if (hit) { work = { ...base, rollId: rid, workOrderStepId: hit.workOrderStepId, meters: hit.meters, meterBasis: phase, readingId: hit.id, serviceAt: hit.createdAt }; break; }
      }
      if (work) break;
      // ② dış (fason) iş: top makbuzdan doğdu — kabul metresi (eski açık-kumaş yolunda initialQty 0 kalabilir).
      const row = byId.get(rid)!;
      const rc = row.parentReceiptId ? receiptById.get(row.parentReceiptId) : undefined;
      if (rc?.step && stations.has(rc.step.stationId)) {
        const meters = row.initialQty.gt(0) ? row.initialQty : row.currentQty;
        work = { ...base, rollId: rid, workOrderStepId: rc.stepId, meters, meterBasis: "RECEIVED", readingId: null, serviceAt: rc.receivedAt };
        break;
      }
    }
    if (!work && leaf.entrySource === RollEntrySource.TAMBUR_SPLIT && leaf.parentRollId) {
      // ③ kesim: iş çocuk topta, metre kesilen metre.
      work = { ...base, rollId: leaf.id, workOrderStepId: leaf.producedInStepId, meters: leaf.initialQty, meterBasis: "CUT", readingId: null, serviceAt: leaf.createdAt };
    }
    work ??= { ...base, rollId: leaf.id, workOrderStepId: null, meters: leaf.currentQty, meterBasis: "DECLARED", readingId: null, serviceAt: p.createdAt };
    // Aynı ata işine iki çocuktan varılır — tek iş (bağ anahtarıyla aynı üçlü).
    works.set(`${work.rollId}:${work.serviceItemId}:${work.workOrderStepId ?? "-"}`, work);
  }
  return [...works.values()];
}
