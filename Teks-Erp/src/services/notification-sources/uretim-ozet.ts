// =============================================================================
// ÜRETİM · KALİTE · KURŞUN · DOKUMA ÖZETLERİ — S2 (geniş katalog 2026-11-14)
// =============================================================================
// Sayılar deftere/kolona dayanır (SystemLog'dan türetilmez) ve raporla AYNI tanımdan okunur:
// biten kumaş `producedRollsSql` (Kalite/Fire karnesi evreni) · kalite rolü `quality_grades.role` ·
// kurşun `listKursunApplications` + `aggregateKursunApplications` (Kurşun Gramajı raporu) · dokuma doff/duruş defteri.
// Pencere `[from, to)`; `producedRollsSql` üst sınırı kapsayıcı olduğundan `to − 1 ms` verilir. Hepsi sıfırsa
// pencere bildirimsiz geçer (damga yine ilerler). Yük tutar taşımaz.
// =============================================================================
import { Prisma, QualityGradeRole, StationKind, WorkOrderEventType } from "@prisma/client";
import { registerDigestSource, type DigestWindow } from "../../jobs/notification-digest.job";
import { factoryTimeHms } from "../../constants/time";
import { producedRollsSql } from "../reports/_produced";
import { K18_DEAD_STATUSES } from "../batch.service";
import { aggregateKursunApplications, listKursunApplications } from "../helpers/process-summary.helper";
import { machineWorkMeters } from "../helpers/meter-reading-work.helper";
import { BRODE_PROPERTY_CODE } from "../helpers/service-quantity.helper";

type Tx = Prisma.TransactionClient;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const closedRange = (w: DigestWindow) => ({ from: w.from, to: new Date(w.to.getTime() - 1) });

/** Pencerede biten kumaş: top, metre ve kalite rolü kırılımı (rolü atanmamış kalite hiçbir role sayılmaz). */
export async function producedTotals(tx: Tx, w: DigestWindow) {
  const rows = await tx.$queryRaw<Array<{ top: number; metre: number; birinci: number; ikinci: number; fire: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS top, COALESCE(SUM(p.qty), 0)::float AS metre,
           COALESCE(SUM(p.qty) FILTER (WHERE g.role = ${QualityGradeRole.FIRST}::"QualityGradeRole"), 0)::float AS birinci,
           COALESCE(SUM(p.qty) FILTER (WHERE g.role = ${QualityGradeRole.SECOND}::"QualityGradeRole"), 0)::float AS ikinci,
           COALESCE(SUM(p.qty) FILTER (WHERE g.role = ${QualityGradeRole.SCRAP}::"QualityGradeRole"), 0)::float AS fire
    FROM ${producedRollsSql(closedRange(w))}
    LEFT JOIN quality_grades g ON g.id = p."qualityGradeId"`);
  const r = rows[0] ?? { top: 0, metre: 0, birinci: 0, ikinci: 0, fire: 0 };
  return { top: Number(r.top), metre: Number(r.metre), birinci: Number(r.birinci), ikinci: Number(r.ikinci), fire: Number(r.fire) };
}

/** Pencerede ilk okuması olan brode işleri (BRODE yetenekli istasyonun makineleri): makine, iş adedi, metre. */
export async function brodeTotals(tx: Tx, w: Pick<DigestWindow, "from" | "to">): Promise<{ makine: number; is: number; metre: number }> {
  const machines = await tx.machine.findMany({
    where: { station: { propertyCapabilities: { some: { property: { code: BRODE_PROPERTY_CODE } } } } },
    select: { id: true },
  });
  const { works } = await machineWorkMeters(machines.map((m) => m.id), w.from, w.to, tx);
  const used = new Set([...works.keys()].map((k) => k.split("|")[0]));
  const metre = [...works.values()].reduce((s, x) => s + Number(x.meters), 0);
  return { makine: used.size, is: works.size, metre: r1(metre) };
}

/** Pencerede biten kumaş (top/metre) + tamamlanan iş emri — gün sonu üretim özeti ve birleşik gün sonu özetinin TEK kaynağı. */
export async function productionWindowCounts(tx: Tx, w: DigestWindow): Promise<{ top: number; metre: number; biten: number }> {
  const t = await producedTotals(tx, w);
  const biten = await tx.workOrderEvent.count({ where: { type: WorkOrderEventType.STATUS_CHANGED, toValue: "COMPLETED", createdAt: { gte: w.from, lt: w.to } } });
  return { top: t.top, metre: r1(t.metre), biten };
}

export function registerProductionDigestSources(): void {
  registerDigestSource({
    kind: "uretim.top-uretildi-ozet",
    compute: async (tx, w) => {
      const t = await producedTotals(tx, w);
      if (t.top === 0) return null;
      return { pencere: w.key, saat: `${factoryTimeHms(w.from).slice(0, 5)}–${factoryTimeHms(w.to).slice(0, 5)}`, top: t.top, metre: r1(t.metre) };
    },
  });
  registerDigestSource({
    kind: "uretim.gun-sonu-ozet",
    compute: async (tx, w) => {
      const c = await productionWindowCounts(tx, w);
      if (c.top + c.biten === 0) return null;
      return { gun: w.label, ...c };
    },
  });
  registerDigestSource({
    kind: "kalite.gunluk-ozet",
    compute: async (tx, w) => {
      const t = await producedTotals(tx, w);
      if (t.metre <= 0) return null;
      return { gun: w.label, metre: r1(t.metre), birinciOran: r1((t.birinci / t.metre) * 100), ikinciMetre: r1(t.ikinci), fireMetre: r1(t.fire) };
    },
  });
  registerDigestSource({
    kind: "kursun.gunluk-ozet",
    compute: async (tx, w) => {
      const apps = await listKursunApplications(closedRange(w), tx);
      if (apps.length === 0) return null;
      const s = aggregateKursunApplications(apps);
      return { gun: w.label, top: s.totals.rollCount, metre: r1(Number(s.totals.meters)), sapan: apps.filter((a) => a.deviatesFromTarget).length };
    },
  });
  // S6a: brode = BRODE yetenekli istasyonun makineleri; iş/metre kârlılıkla aynı tanımdan (`machineWorkMeters`, CUT>OUT>IN).
  registerDigestSource({
    kind: "brode.gunluk-ozet",
    compute: async (tx, w) => {
      const t = await brodeTotals(tx, w);
      return t.is === 0 ? null : { gun: w.label, ...t };
    },
  });
  registerDigestSource({
    kind: "dokuma.vardiya-ozet",
    compute: async (tx, w) => {
      const doffs = await tx.doffEvent.findMany({
        where: { revokedAt: null, doffedAt: { gte: w.from, lt: w.to } },
        select: { rolls: { where: { status: { notIn: K18_DEAD_STATUSES } }, select: { initialQty: true } } },
      });
      const stops = await tx.machineStopEvent.findMany({
        where: { revokedAt: null, startedAt: { gte: w.from, lt: w.to }, machine: { station: { kind: StationKind.WEAVING } } },
        select: { durationSec: true },
      });
      const doff = doffs.reduce((n, d) => n + d.rolls.length, 0);
      if (doff === 0 && stops.length === 0) return null;
      const metre = doffs.reduce((m, d) => d.rolls.reduce((x, r) => (r.initialQty ? x.plus(r.initialQty) : x), m), new Prisma.Decimal(0));
      const durusDk = Math.round(stops.reduce((s, x) => s + (x.durationSec ?? 0), 0) / 60);
      return { vardiyaId: w.key, vardiyaAd: w.label, doff, metre: r1(metre.toNumber()), durus: stops.length, durusDk };
    },
  });
}
