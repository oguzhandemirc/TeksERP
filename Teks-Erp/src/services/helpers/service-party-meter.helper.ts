// =============================================================================
// HİZMET İŞİ ↔ PARTİ METRESİ — `finance.serviceBilling.meterBasis = MAX_DECLARED` dağıtıcısı (GK metre, 2026-11-10)
// =============================================================================
// Partinin faturalanan metresi (kural 1–2) TEK çözücüden (`resolvePartyMeters`); burada yalnız işlere dağıtılır:
// parti × aile (kurşun · bayrak özelliği) başına her işin payı = faturalanan × işin metresi / ailenin BÜTÜN işlerinin
// metresi (payda sevkten bağımsız → partinin parça parça sevki toplamı şişirmez). Ailenin bütün işleri bu taslaktaysa
// yuvarlama farkı son işe yazılır (Σ = parti metresi, birebir). Varsayılan ayarda bu dosya hiç çağrılmaz.
// =============================================================================
import { MeterPhase, Prisma, type ServiceQtyUnit } from "@prisma/client";
import prisma from "../../lib/prisma";
import { resolvePartyMeters, type BilledBasis } from "./meter-compare.helper";
import { listKursunApplications } from "./process-summary.helper";
import { listFlagServiceWorks } from "./service-flag-work.helper";
import { serviceWorkUnit } from "./service-quantity.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Taslak işinin metre karşılaştırması (sözleşme: `meterCompare`) — işin PAYI. */
export interface WorkMeterCompare {
  declaredM: number | null;
  measuredM: number | null;
  billedM: number;
  basis: BilledBasis;
}

export interface PartyScalableWork {
  rollId: string;
  meters: Prisma.Decimal;
  quantity: Prisma.Decimal | null;
  qtyUnit: ServiceQtyUnit;
  meterCompare?: WorkMeterCompare;
}

export interface DiscoveredWork { key: string; rollId: string; family: string; meters: Prisma.Decimal }

const share = (total: number, part: Prisma.Decimal, denom: Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(total).mul(part).div(denom).toDecimalPlaces(3);

/** Metre birimli işleri parti metresine oranla ölçekler (yerinde); `meterCompare` doldurur. */
export async function scaleWorksToPartyMeters<W extends PartyScalableWork>(
  works: W[],
  ctx: { familyOf: (w: W) => string | null; keyOf: (w: W) => string; discover: (rollIds: string[]) => Promise<DiscoveredWork[]>; db?: Db },
): Promise<void> {
  const db = ctx.db ?? prisma;
  const scalable = works.filter((w) => w.qtyUnit === "METER" && ctx.familyOf(w) !== null);
  if (scalable.length === 0) return;
  const { parties, partyOfRoll } = await resolvePartyMeters([...new Set(scalable.map((w) => w.rollId))], db);
  const live = parties.filter((p) => p.billedM !== null && p.billedBasis !== null);
  if (live.length === 0) return;
  const partyByKey = new Map(live.map((p) => [p.partyKey, p]));
  const discovered = await ctx.discover([...new Set(live.flatMap((p) => p.rollIds))]);

  const groups = new Map<string, { works: W[]; denom: Prisma.Decimal; allKeys: Set<string> }>();
  const groupOf = (rollId: string, family: string) => {
    const party = partyOfRoll.get(rollId);
    return party && partyByKey.has(party) ? `${party}|${family}` : null;
  };
  for (const d of discovered) {
    const g = groupOf(d.rollId, d.family);
    if (!g) continue;
    const cur = groups.get(g) ?? { works: [], denom: new Prisma.Decimal(0), allKeys: new Set<string>() };
    if (!cur.allKeys.has(d.key)) { cur.allKeys.add(d.key); cur.denom = cur.denom.plus(d.meters); }
    groups.set(g, cur);
  }
  for (const w of scalable) {
    const g = groupOf(w.rollId, ctx.familyOf(w)!);
    if (!g) continue;
    const cur = groups.get(g) ?? { works: [], denom: new Prisma.Decimal(0), allKeys: new Set<string>() };
    // Keşifte görünmeyen iş (ör. kendisi de sevk edilen ata parçası) paydaya kendi metresiyle girer.
    if (!cur.allKeys.has(ctx.keyOf(w))) { cur.allKeys.add(ctx.keyOf(w)); cur.denom = cur.denom.plus(w.meters); }
    cur.works.push(w);
    groups.set(g, cur);
  }
  for (const [g, grp] of groups) {
    if (grp.works.length === 0 || grp.denom.lte(0)) continue;
    const party = partyByKey.get(g.slice(0, g.lastIndexOf("|")))!;
    const billed = party.billedM!;
    const sorted = [...grp.works].sort((a, b) => ctx.keyOf(a).localeCompare(ctx.keyOf(b)));
    const complete = [...grp.allKeys].every((k) => sorted.some((w) => ctx.keyOf(w) === k));
    let given = new Prisma.Decimal(0);
    sorted.forEach((w, i) => {
      const own = w.meters;
      const part = complete && i === sorted.length - 1 ? new Prisma.Decimal(billed).minus(given).toDecimalPlaces(3) : share(billed, own, grp.denom);
      given = given.plus(part);
      w.meterCompare = {
        declaredM: party.declaredM === null ? null : Number(share(party.declaredM, own, grp.denom)),
        measuredM: party.measuredMaxM === null ? null : Number(share(party.measuredMaxM, own, grp.denom)),
        billedM: Number(part),
        basis: party.billedBasis!,
      };
      w.meters = part;
      w.quantity = part;
    });
  }
}

// ── Hizmet çözücüsüne bağlantı: aile, iş anahtarı, partinin bütün işleri ──────────────────────────────────

type ServiceWorkLike = PartyScalableWork & { source: string; workOrderStepId: string | null };
type LeadReadings = (apps: Array<{ rollId: string; workOrderStepId: string }>, db: Db) => Promise<{ out: Map<string, { meters: Prisma.Decimal }> }>;

/** Bayrak işinin özelliği — dağıtım ailesi (iş nesnesinin şekli değişmesin diye nesne dışında). */
const flagPropertyOf = new WeakMap<object, string>();
export function markFlagFamily<W extends object>(w: W, propertyId: string): W { flagPropertyOf.set(w, propertyId); return w; }

const isLead = (source: string): boolean => source === "TABLET" || source === "KAGIT";
/** Aile: kurşun tek aile, bayrak işi özelliği başına; adım/dokuma işi dağıtılmaz. */
function familyOf(w: ServiceWorkLike): string | null {
  if (isLead(w.source)) return "LEAD";
  const p = w.source === "PROPERTY" ? flagPropertyOf.get(w) : undefined;
  return p ? `F:${p}` : null;
}
/** İş anahtarı top × adım × aile (aile başına top-adımda tek iş) — dağıtımın "aile bu taslakta tam mı" sorusu. */
const workKey = (rollId: string, stepId: string | null, family: string): string => `${rollId}:${stepId ?? "-"}:${family}`;
const keyOf = (w: ServiceWorkLike): string => workKey(w.rollId, w.workOrderStepId, familyOf(w) ?? "-");

/** Partinin BÜTÜN kurşun + metre birimli bayrak işleri (sevkten, bağdan bağımsız) — dağıtımın paydası. */
async function discoverPartyWorks(rollIds: string[], brodeUnit: ServiceQtyUnit, db: Db, loadReadings: LeadReadings): Promise<DiscoveredWork[]> {
  const apps = await listKursunApplications({ rollIds }, db);
  const { out } = await loadReadings(apps, db);
  const lead = apps.map((a) => {
    const r = out.get(`${a.rollId}:${a.workOrderStepId}:${MeterPhase.OUT}`) ?? out.get(`${a.rollId}:${a.workOrderStepId}:${MeterPhase.IN}`);
    return { key: workKey(a.rollId, a.workOrderStepId, "LEAD"), rollId: a.rollId, family: "LEAD", meters: r ? r.meters : a.meters };
  });
  const flag = await listFlagServiceWorks(rollIds, "OUT", { db });
  const flags = flag.works
    .filter((f) => serviceWorkUnit(f.propertyCode, brodeUnit) === "METER")
    .map((f) => ({ key: workKey(f.rollId, f.workOrderStepId, `F:${f.propertyId}`), rollId: f.rollId, family: `F:${f.propertyId}`, meters: f.meters }));
  return [...lead, ...flags];
}

/**
 * `MAX_DECLARED`: `alsoScale` (kurşun işleri) verilmişse onlarla birlikte `works`ü parti metresine (kural 1–2) oranla
 * ölçekler (yerinde) ve `works`ü döner; verilmemişse hiçbir şey yapmaz (varsayılan tabanlar bayt-aynı).
 */
export async function withPartyScale<W extends ServiceWorkLike>(alsoScale: W[] | undefined, works: W[], ctx: { brodeUnit: ServiceQtyUnit; db: Db; loadReadings: LeadReadings }): Promise<W[]> {
  if (!alsoScale) return works;
  await scaleWorksToPartyMeters([...alsoScale, ...works], { familyOf, keyOf, db: ctx.db, discover: (ids) => discoverPartyWorks(ids, ctx.brodeUnit, ctx.db, ctx.loadReadings) });
  return works;
}
