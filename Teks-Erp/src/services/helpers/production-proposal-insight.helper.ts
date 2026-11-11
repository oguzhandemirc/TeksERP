// =============================================================================
// ÜRETİM ÖNERİSİ ÖNİZLEMESİ — KARAR ÖZETLERİ (salt okuma; Seyitoğlu 2. bölüm K1)
// =============================================================================
// Dokuma grubu başına üç özet: tezgâh (`loom-suggestion.helper` kararı), iplik (`yarn-need` çekirdeği: kg/m maliyet
// motorundan, stok/yolda köprüden) ve süre (`theoreticalMPerHourDecimal` × plan randımanı). Formül yazılmaz; her değer
// tek kaynak helper'dan. Hesaplanamayan özet null'dır (0 ya da tahmin değil). Pahalı okumalar grup sayısından bağımsız
// TEK kez yapılır (tezgâh zemini, yapı kaynakları, stok, alış, levent).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { GroupConstructions, WeavingProposal } from "./production-proposal.helper";
import { LOOM_TIERS, suggestLoomsForDrafts, type LoomTier } from "./loom-suggestion.helper";
import { theoreticalMPerHourDecimal } from "./dokuma-levent-rapor.helper";
import { buildCostInput, loadCostSourcesTx } from "./cost-assembler.helper";
import { yarnUsagePerM } from "./fabric-cost.helper";
import { readOpenPurchase, readReadyBeams, readYarnReservation, readYarnStock } from "./maliyet-bridge.helper";
import { readyWarpSpecIds, yarnKgByYarn, yarnShortKg, type ReadyItem } from "../reports/yarn-need.report.service";
import { readMaliyetEnabled } from "../system-setting.service";
import type { YarnWasteSource } from "./yarn-waste.helper";

type Dec = Prisma.Decimal;
const round3 = (d: Dec): number => d.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toNumber();
const round2 = (d: Dec): number => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();

export interface LoomSummary {
  /** Karşılaştırılan gerekli metre = grubun ham plan metresi. */
  requiredM: number;
  /** En iyi aday (öneri sırasının ilki). */
  best: {
    machineId: string;
    code: string;
    name: string;
    tier: LoomTier;
    /** Yalnız BEAM_SHORT: takılı leventlerle dokunabilecek metre; diğer sınıflarda null. */
    weavableM: number | null;
    /** Yalnız WARP_CHANGE: gerekeni karşılayan ilk READY levent no'su; yoksa null. */
    readyBeamNo: string | null;
    sameDesignRunning: boolean;
    hasOpenRun: boolean;
    widthWarning: boolean;
  };
  /** Sınıf başına aday sayısı (tüm tezgâhlar). */
  counts: Record<LoomTier, number>;
}

export interface YarnSummaryRow {
  yarnItemId: string;
  code: string;
  name: string;
  /** Bu grubun ham metresi için gereken kg (çözgü + atkı, hazır levent düşülmüş). */
  needKg: number;
  /** max(0, gereken − serbest stok − açık alış); iplik modülü kapalıysa null (bilinmiyor). Ayırma açıkken serbest = `freeKg`. */
  shortKg: number | null;
  /** SY-3 I1 (YALNIZ ayar açıkken anahtar var): açık dokuma işlerine ayrılan kg (tesis geneli). */
  reservedKg?: number;
  /** SY-3 I1: serbest stok − ayrılan (eksiye inebilir); stok bilinmiyorsa null. */
  freeKg?: number | null;
  /** SY-3 I2: `IPLIK` iplik kartı firesi, `KART` çözgü/atkı fire zinciri. */
  wasteSource: YarnWasteSource;
}

export interface YarnSummary {
  rawM: number;
  yarns: YarnSummaryRow[];
  /** Σ shortKg; stok bilinmiyorsa null. */
  totalShortKg: number | null;
  /** Kaynaklar: false = o modül kapalı, değeri düşülmedi. */
  sources: { stock: boolean; openPurchase: boolean; readyBeams: boolean };
}

export interface WeavingDurationEstimate {
  /** Süre hesabındaki tezgâh = tezgâh özetinin en iyi adayı. */
  machineId: string;
  picksPerCm: number;
  planRpm: number;
  planEfficiencyPct: number;
  /** Yalnız DOKUMA süresi (saat); tezgâh şimdi boş başlarsa varsayımı; terbiye/sevk dahil değil. */
  weavingHours: number;
  /** weavingHours ÷ 24 (7/24 çalışma esası). */
  weavingDays: number;
  /** Termine kalan saat (şu andan); termin yoksa null; geçmişse negatif. */
  hoursUntilDeadline: number | null;
  /** Ham karşılaştırma: weavingHours ≤ hoursUntilDeadline. "Yetişir" hükmü DEĞİL (yalnız dokuma). Termin yoksa null. */
  weavingOnlyFitsDeadline: boolean | null;
}

export interface WeavingInsights {
  loomSummary: LoomSummary | null;
  yarnSummary: YarnSummary | null;
  durationEstimate: WeavingDurationEstimate | null;
}

/** Tezgâh özetleri — tek toplu karar; ham metre yoksa ya da aday yoksa (levent takibi kapalı, zemin yok) null. */
async function loomSummaries(groups: WeavingProposal[], constructions: GroupConstructions): Promise<Map<string, LoomSummary | null>> {
  const out = new Map<string, LoomSummary | null>();
  const measured = groups.filter((g) => g.plannedM != null);
  const decisions = await suggestLoomsForDrafts(prisma, measured.map((g) => ({ itemId: g.itemId, recipeId: g.recipeId, plannedM: g.plannedM, construction: constructions.get(g.key) })));
  measured.forEach((g, i) => {
    const d = decisions[i]!;
    const best = d.candidates[0];
    if (!best) return out.set(g.key, null);
    const counts = Object.fromEntries(LOOM_TIERS.map((t) => [t, d.candidates.filter((c) => c.tier === t).length])) as Record<LoomTier, number>;
    out.set(g.key, {
      requiredM: g.plannedM!,
      best: {
        machineId: best.machineId, code: best.code, name: best.name, tier: best.tier,
        weavableM: best.tier === "BEAM_SHORT" ? best.weavableM : null,
        readyBeamNo: best.tier === "WARP_CHANGE" ? (best.readyBeamNos[0] ?? null) : null,
        sameDesignRunning: best.sameDesignRunning, hasOpenRun: best.hasOpenRun, widthWarning: best.widthWarning,
      },
      counts,
    });
  });
  return out;
}

/**
 * İplik özetleri. "Eksik" iplik ihtiyaç raporunun satır formülüdür (`yarnShortKg`), ama ihtiyaç YALNIZ bu grubun ham
 * metresidir ve stok/alış/hazır levent bu gruba ayrılmış sayılır (diğer açık talep düşülmez) — toplam tablo raporda.
 */
export async function yarnSummaries(groups: WeavingProposal[]): Promise<Map<string, YarnSummary | null>> {
  const out = new Map<string, YarnSummary | null>();
  const measured = groups.filter((g) => g.plannedM != null);
  if (measured.length === 0 || !(await readMaliyetEnabled())) return out;
  const src = await loadCostSourcesTx(prisma as unknown as Prisma.TransactionClient, [...new Set(measured.map((g) => g.itemId))].sort(), [],
    [...new Set(measured.map((g) => g.recipeId).filter((x): x is string => !!x))]);
  const ready = new Map<string, ReadyItem>();
  for (const g of measured) {
    const item = src.items.get(g.itemId);
    if (!item || item.itemType !== "FABRIC") continue;
    const input = buildCostInput(src, g.recipeId ? { itemId: g.itemId, recipeId: g.recipeId } : { itemId: g.itemId });
    const usage = yarnUsagePerM(input);
    if (usage.missing.length > 0 || !usage.warp) continue;
    const rawM = new Prisma.Decimal(g.plannedM!);
    ready.set(g.key, { d: { itemId: g.itemId, lineCount: g.orderLines.length, meters: rawM }, code: item.code, input, usage, rawM });
  }
  if (ready.size === 0) return out;
  // SY-3 I1: kapalıyken null, sorgu yok; açıkken hazır levent önce açık işlere gider, öneri kalanı görür.
  const reservation = await readYarnReservation({ leventDus: true });
  const physicalBeams = await readReadyBeams(readyWarpSpecIds([...ready.values()]));
  const beams = physicalBeams && reservation?.beamsAfter
    ? new Map([...physicalBeams].map(([id, b]) => [id, reservation.beamsAfter!.get(id) ?? b]))
    : physicalBeams;
  const perGroup = new Map([...ready].map(([key, r]) => [key, yarnKgByYarn([r], beams).perYarn]));
  const yarnIds = [...new Set([...perGroup.values()].flatMap((m) => [...m.keys()]))].sort();
  const stock = await readYarnStock(yarnIds);
  const purchase = await readOpenPurchase(yarnIds);
  const names = new Map((yarnIds.length ? await prisma.item.findMany({ where: { id: { in: yarnIds } }, select: { id: true, code: true, name: true } }) : []).map((n) => [n.id, n]));
  for (const [key, perYarn] of perGroup) {
    let total = new Prisma.Decimal(0);
    const yarns = [...perYarn].map(([id, a]) => {
      const need = a.warp.plus(a.weft);
      const stockKg = stock ? (stock.byItem.get(id)?.serbestKg ?? new Prisma.Decimal(0)) : null;
      const reservedKg = reservation?.reservedKg.get(id)?.kg ?? new Prisma.Decimal(0);
      const freeKg = stockKg ? stockKg.minus(reservedKg) : null;
      const short = stockKg ? yarnShortKg(need, reservation ? freeKg : stockKg, purchase?.get(id) ?? null) : null;
      if (short) total = total.plus(short);
      const res = reservation ? { reservedKg: round3(reservedKg), freeKg: freeKg ? round3(freeKg) : null } : {};
      return { yarnItemId: id, code: names.get(id)?.code ?? "", name: names.get(id)?.name ?? "", needKg: round3(need), shortKg: short ? round3(short) : null, wasteSource: a.wasteSource, ...res, short };
    });
    yarns.sort((x, y) => (y.short ? y.short.comparedTo(x.short ?? 0) : 0) || x.code.localeCompare(y.code, "tr"));
    out.set(key, {
      rawM: round3(ready.get(key)!.rawM),
      yarns: yarns.map(({ short: _s, ...row }) => row),
      totalShortKg: stock ? round3(total) : null,
      sources: { stock: stock !== null, openPurchase: purchase !== null, readyBeams: beams !== null },
    });
  }
  return out;
}

/** SY-3 I1: ayrılan miktar yüzünden eksik doğan iplikler için `ApiResponse.warnings` metinleri (ayar kapalıyken boş). */
export function yarnReservationWarnings(groups: Array<{ itemName?: string; yarnSummary?: YarnSummary | null }>): string[] {
  const out: string[] = [];
  for (const g of groups) {
    for (const y of g.yarnSummary?.yarns ?? []) {
      if (y.reservedKg !== undefined && y.reservedKg > 0 && (y.shortKg ?? 0) > 0) {
        out.push(`${g.itemName ? g.itemName + ": " : ""}${y.code || y.name} ipliğinin ${y.reservedKg} kg'ı açık dokuma işlerine ayrılmış; serbest miktar yetmiyor (eksik ${y.shortKg} kg).`);
      }
    }
  }
  return out;
}

/** Süre: saat = ham metre ÷ (teorik m/saat × randıman%). Plan devri/randımanı/atkı sıklığı eksikse null (varsayılan uydurulmaz). */
async function durationEstimates(
  groups: WeavingProposal[], constructions: GroupConstructions, looms: Map<string, LoomSummary | null>, at: { deadline: Date | null; now: Date },
): Promise<Map<string, WeavingDurationEstimate | null>> {
  const { deadline, now } = at;
  const out = new Map<string, WeavingDurationEstimate | null>();
  const machineIds = [...new Set([...looms.values()].flatMap((l) => (l ? [l.best.machineId] : [])))];
  if (machineIds.length === 0) return out;
  const plans = new Map((await prisma.machine.findMany({ where: { id: { in: machineIds } }, select: { id: true, planRpm: true, planEfficiencyPct: true } })).map((m) => [m.id, m]));
  const hoursLeft = deadline ? Math.round(((deadline.getTime() - now.getTime()) / 3_600_000) * 100) / 100 : null;
  for (const g of groups) {
    const loom = looms.get(g.key);
    const plan = loom ? plans.get(loom.best.machineId) : undefined;
    const picks = constructions.get(g.key)?.weft?.picksPerCm ?? null;
    if (!loom || !plan || plan.planRpm == null || plan.planEfficiencyPct == null || picks == null || g.plannedM == null) continue;
    const eff = new Prisma.Decimal(plan.planEfficiencyPct);
    const perHour = theoreticalMPerHourDecimal(plan.planRpm, picks);
    if (perHour === null || !eff.gt(0)) continue;
    const hours = new Prisma.Decimal(g.plannedM).div(perHour.mul(eff).div(100));
    const weavingHours = round2(hours);
    out.set(g.key, {
      machineId: plan.id, picksPerCm: Number(picks), planRpm: plan.planRpm, planEfficiencyPct: Number(eff),
      weavingHours, weavingDays: round2(hours.div(24)),
      hoursUntilDeadline: hoursLeft, weavingOnlyFitsDeadline: hoursLeft === null ? null : weavingHours <= hoursLeft,
    });
  }
  return out;
}

/** Grup anahtarı → üç özet; `yarn` false iken iplik özeti hesaplanmaz (izin yok → null). */
export async function buildWeavingInsights(
  groups: WeavingProposal[], constructions: GroupConstructions, opts: { deadline: Date | null; yarn: boolean; now?: Date },
): Promise<Map<string, WeavingInsights>> {
  const looms = await loomSummaries(groups, constructions);
  const yarns = opts.yarn ? await yarnSummaries(groups) : new Map<string, YarnSummary | null>();
  const durations = await durationEstimates(groups, constructions, looms, { deadline: opts.deadline, now: opts.now ?? new Date() });
  return new Map(groups.map((g) => [g.key, { loomSummary: looms.get(g.key) ?? null, yarnSummary: yarns.get(g.key) ?? null, durationEstimate: durations.get(g.key) ?? null }]));
}
