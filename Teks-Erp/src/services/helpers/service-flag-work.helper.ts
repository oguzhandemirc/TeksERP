// =============================================================================
// BAYRAK TİPİ HİZMET İŞLERİ — Tambur · etek kesim · brode (Gülkesim dalga 2 · H10, karar belgesi §5)
// =============================================================================
// Soru: "bu topa kurşun DIŞINDA hangi faturalanacak iş yapıldı, kaç metre?"
// İşin izi topun AKTİF BAYRAK özelliğidir (`RollProperty`; kesimde `inheritRollPropertiesTx`
// ile çocuğa geçer); kalem `FabricProperty.serviceItemId`ten. Kurşun bayrağı ve çeşidi
// (gramaj) olan bayraklar BURADA OKUNMAZ — onlar `listKursunApplications` yolundadır.
// Metre sırası (ilk bulunan; iş, metrenin ölçüldüğü topa bağlanır):
//   ① özelliği verebilen istasyondaki adımın aktif okuması (iç brode) — topta ya da atasında
//   ② o istasyondaki fason makbuz kalemi `receivedQty` (dış brode) — RECEIVED
//   ③ top Tambur bölmesiyle doğduysa kesilen metre (`initialQty`) — CUT, çocuk topta
//   ④ yoksa topun mevcut metresi — DECLARED (uyarı ayarı H7 `missingMeter`)
// Yalnız okur. `FinishingRate` (bizim ödediğimiz maliyet) burada da okunmaz.
// =============================================================================
import { MachineDataSource, MeterPhase, Prisma, RollEntrySource } from "@prisma/client";
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
    select: { id: true, parentRollId: true, entrySource: true, initialQty: true, currentQty: true, producedInStepId: true, createdAt: true },
  });
  const byId = new Map(rolls.map((r) => [r.id, r]));
  const parents = new Set(rolls.map((r) => r.parentRollId).filter((v): v is string => v !== null && byId.has(v)));
  const leaves = rolls.filter((r) => !parents.has(r.id));
  if (leaves.length === 0) return [];

  const props = await prisma.rollProperty.findMany({
    where: {
      rollId: { in: leaves.map((r) => r.id) },
      ...ACTIVE_ROLL_PROPERTY,
      property: { valueType: "FLAG", serviceItemId: { not: null }, code: { not: KURSUN_PROPERTY_CODE }, variant: { is: null } },
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
  const receiptItems = allStations.length === 0 ? [] : await prisma.subcontractorReceiptItem.findMany({
    where: { newRollId: { in: chainIds }, receivedQty: { not: null }, receipt: { cancelledAt: null, step: { stationId: { in: allStations } } } },
    select: { newRollId: true, receivedQty: true, receipt: { select: { stepId: true, receivedAt: true, step: { select: { stationId: true } } } } },
    orderBy: [{ receipt: { receivedAt: "asc" } }, { id: "asc" }],
  });

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
      // ① okuma: seçilen faz sırasıyla (OUT tabanında OUT → IN), adımın en son aktif okuması.
      for (const phase of phases) {
        const hit = readings.filter((r) => r.rollId === rid && r.phase === phase && stations.has(r.step.stationId)).at(-1);
        if (hit) { work = { ...base, rollId: rid, workOrderStepId: hit.workOrderStepId, meters: hit.meters, meterBasis: phase, readingId: hit.id, serviceAt: hit.createdAt }; break; }
      }
      if (work) break;
      // ② dış (fason) iş: aynı adımın kısmi kabulleri toplanır; hizmet anı ilk kabul.
      const rec = receiptItems.filter((i) => i.newRollId === rid && i.receipt.step && stations.has(i.receipt.step.stationId));
      if (rec.length > 0) {
        const stepId = rec[0]!.receipt.stepId;
        const same = rec.filter((i) => i.receipt.stepId === stepId);
        const sum = same.reduce((a, i) => a.plus(i.receivedQty!), new Prisma.Decimal(0));
        work = { ...base, rollId: rid, workOrderStepId: stepId, meters: sum, meterBasis: "RECEIVED", readingId: null, serviceAt: same[0]!.receipt.receivedAt };
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
