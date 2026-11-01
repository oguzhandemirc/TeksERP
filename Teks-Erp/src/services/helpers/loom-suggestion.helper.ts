// =============================================================================
// TEZGÂH ÖNERİSİ — "Bu iş için hangi tezgâh hazır?" (TEK KAYNAK, salt okuma; SY-M2, tasarım §14.5-8, K15)
// =============================================================================
// T1 HAZIR = kendi leventi olan her çözgü (zemin + SEPARATE_BEAM katmanları) tezgâhta takılı ∧ kalanı ≥
// gerekli · T2 LEVENT YETMEZ ("N m dokur") · T3 ÇÖZGÜ DEĞİŞİMİ (uygun READY levent varsa no'su). SHARED_BEAM
// zemin leventinde, CREEL leventsiz — ayrı levent aranmaz. Öneri SIRALAMADIR; iş vermeyi engellemez. Tarak
// eni ürün eninden darsa yalnız UYARI. Takılı levent + kalan YALNIZ `mountedBeamViewsTx` / `readBeamStockBySpec`ten.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { LOOM_MACHINE_WHERE } from "../../constants/loom-shift";
import { resolveEffectiveConstruction } from "./effective-construction.helper";
import { mountedBeamViewsTx, type MountedBeamView } from "./warp-beam-mount.helper";
import { readBeamStockBySpec, type StockBeam } from "./warp-beam-stock.helper";
import { OPEN_MACHINE_RUN_WHERE } from "./machine-run-open.helper";
import { fabricFromWarpM, warpRequirements, type WarpRequirement } from "./beam-need.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export const LOOM_TIERS = ["READY", "BEAM_SHORT", "WARP_CHANGE"] as const;
export type LoomTier = (typeof LOOM_TIERS)[number];

export const LOOM_SUGGESTION_WARNING = {
  reedNarrower: "REED_NARROWER_THAN_FABRIC",
  noGroundWarp: "NO_GROUND_WARP",
} as const;

export type LoomSuggestionInput =
  | { weavingOrderId: string }
  | { itemId: string; recipeId?: string | null; plannedM?: number | null; warpSpecId?: string | null };

export interface LoomCandidate {
  machineId: string;
  code: string;
  name: string;
  tier: LoomTier;
  /** T2: takılı leventlerle dokunabilecek kumaş metresi (en kısıtlı çözgüden). */
  weavableM: number | null;
  /** T1: gerekenin üstündeki en küçük kalan (m) — "kalan en yakın" sırası. */
  surplusM: number | null;
  /** T3: takılı olmayan çözgüler ve onlar için hazır (READY) leventlerin numaraları. */
  missingWarpSpecCodes: string[];
  readyBeamNos: string[];
  /** Tezgâhta aynı desen/ürün koşuyor mu; açık koşum var mı. */
  sameDesignRunning: boolean;
  hasOpenRun: boolean;
  /** Tarak eni ürün eninden dar — eleme DEĞİL, rozet. */
  widthWarning: boolean;
}

export interface LoomSuggestion {
  weavingOrderId: string | null;
  itemId: string;
  recipeId: string | null;
  plannedM: number | null;
  requirements: WarpRequirement[];
  candidates: LoomCandidate[];
  warnings: Array<{ code: string; message: string }>;
}

interface LoomContext {
  loom: { id: string; code: string; name: string };
  mounted: MountedBeamView[];
  openRuns: Array<{ itemId: string | null; weaveDesignId: string | null }>;
}

/** Tek tezgâhın sınıfı (saf). `reqs` yalnız kendi leventi olan çözgüler. */
export function classifyLoom(
  reqs: WarpRequirement[], ctx: LoomContext, stock: Map<string, StockBeam[]>,
  target: { itemId: string; weaveDesignId: string | null; widthWarning: boolean },
): LoomCandidate {
  const { widthWarning } = target;
  const sameDesignRunning = ctx.openRuns.some((r) => (target.weaveDesignId ? r.weaveDesignId === target.weaveDesignId : r.itemId === target.itemId));
  const base = {
    machineId: ctx.loom.id, code: ctx.loom.code, name: ctx.loom.name, weavableM: null, surplusM: null,
    missingWarpSpecCodes: [] as string[], readyBeamNos: [] as string[], sameDesignRunning, hasOpenRun: ctx.openRuns.length > 0, widthWarning,
  };
  const onLoom = reqs.map((r) => ({ r, remainingM: ctx.mounted.filter((b) => b.warpSpecCode === r.warpSpecCode).reduce((s, b) => s + b.remainingM, 0), mounted: ctx.mounted.some((b) => b.warpSpecCode === r.warpSpecCode) }));
  const missing = onLoom.filter((x) => !x.mounted);
  if (missing.length) {
    const readyBeamNos = missing.flatMap((x) => (stock.get(x.r.warpSpecId) ?? []).filter((b) => b.status === "READY").map((b) => b.beamNo));
    return { ...base, tier: "WARP_CHANGE", missingWarpSpecCodes: missing.map((x) => x.r.warpSpecCode), readyBeamNos };
  }
  const short = onLoom.filter((x) => x.r.requiredM != null && x.remainingM < x.r.requiredM);
  if (short.length) {
    const weavableM = Math.min(...onLoom.map((x) => fabricFromWarpM(x.remainingM, x.r.takeUpPct)));
    return { ...base, tier: "BEAM_SHORT", weavableM };
  }
  const surpluses = onLoom.filter((x) => x.r.requiredM != null).map((x) => x.remainingM - (x.r.requiredM ?? 0));
  return { ...base, tier: "READY", surplusM: surpluses.length ? Math.round(Math.min(...surpluses) * 1000) / 1000 : null };
}

const TIER_RANK: Record<LoomTier, number> = { READY: 0, BEAM_SHORT: 1, WARP_CHANGE: 2 };

/** Sıra: kademe; T1 içinde aynı desen koşuyor > boş > kalan en yakın; T2'de çok dokuyan; T3'te hazır leventi olan; sonra kod. */
export function compareCandidates(a: LoomCandidate, b: LoomCandidate): number {
  if (a.tier !== b.tier) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (a.tier === "READY") {
    const ra = a.sameDesignRunning ? 0 : a.hasOpenRun ? 2 : 1;
    const rb = b.sameDesignRunning ? 0 : b.hasOpenRun ? 2 : 1;
    if (ra !== rb) return ra - rb;
    if ((a.surplusM ?? 0) !== (b.surplusM ?? 0)) return (a.surplusM ?? 0) - (b.surplusM ?? 0);
  } else if (a.tier === "BEAM_SHORT") {
    if ((a.weavableM ?? 0) !== (b.weavableM ?? 0)) return (b.weavableM ?? 0) - (a.weavableM ?? 0);
  } else if ((a.readyBeamNos.length > 0) !== (b.readyBeamNos.length > 0)) {
    return a.readyBeamNos.length > 0 ? -1 : 1;
  }
  return a.code.localeCompare(b.code);
}

async function resolveTarget(db: Db, input: LoomSuggestionInput) {
  if ("weavingOrderId" in input) {
    const wo = await db.weavingOrder.findUnique({ where: { id: input.weavingOrderId }, select: { id: true, itemId: true, recipeId: true, plannedM: true, warpSpecId: true } });
    if (!wo) throw AppError.notFound("Dokuma işi bulunamadı");
    return { weavingOrderId: wo.id, itemId: wo.itemId, recipeId: wo.recipeId, plannedM: wo.plannedM == null ? null : Number(wo.plannedM), warpSpecId: wo.warpSpecId };
  }
  return { weavingOrderId: null, itemId: input.itemId, recipeId: input.recipeId ?? null, plannedM: input.plannedM ?? null, warpSpecId: input.warpSpecId ?? null };
}

/** Dokuma işi (ya da taslak) için tezgâh önerisi — salt okuma, kilitsiz. */
export async function suggestLoomsForWeaving(db: Db, input: LoomSuggestionInput): Promise<LoomSuggestion> {
  const t = await resolveTarget(db, input);
  const c = await resolveEffectiveConstruction(db, t.itemId, t.recipeId);
  const groundId = t.warpSpecId ?? c.groundWarp?.id ?? null;
  const out: LoomSuggestion = { weavingOrderId: t.weavingOrderId, itemId: t.itemId, recipeId: t.recipeId, plannedM: t.plannedM, requirements: [], candidates: [], warnings: [] };
  const ground = groundId ? await db.warpSpec.findUnique({ where: { id: groundId }, select: { id: true, code: true, takeUpPct: true, reedWidthCm: true } }) : null;
  if (!ground) {
    out.warnings.push({ code: LOOM_SUGGESTION_WARNING.noGroundWarp, message: "Ürünün zemin çözgüsü tanımlı değil — tezgâh önerisi çıkarılamaz." });
    return out;
  }
  out.requirements = warpRequirements(c, ground, t.plannedM);
  const widthWarning = ground.reedWidthCm != null && c.widthCm != null && ground.reedWidthCm.lt(c.widthCm);
  if (widthWarning) {
    out.warnings.push({ code: LOOM_SUGGESTION_WARNING.reedNarrower, message: `Çözgü kartının tarak eni (${ground.reedWidthCm!.toString()} cm) ürün eninden (${c.widthCm!.toString()} cm) dar.` });
  }
  const own = out.requirements.filter((r) => r.ownBeam);
  const looms = await db.machine.findMany({ where: LOOM_MACHINE_WHERE, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const ids = looms.map((l) => l.id);
  const mounted = await mountedBeamViewsTx(db, ids);
  const stock = await readBeamStockBySpec(db, own.map((r) => r.warpSpecId));
  const runs = ids.length
    ? await db.machineRun.findMany({ where: { machineId: { in: ids }, ...OPEN_MACHINE_RUN_WHERE }, select: { machineId: true, itemId: true, weavingOrder: { select: { itemId: true, weaveDesignId: true } } } })
    : [];
  const target = { itemId: t.itemId, weaveDesignId: c.weaveDesign?.id ?? null, widthWarning };
  out.candidates = looms.map((loom) => classifyLoom(own, {
    loom, mounted: mounted.get(loom.id) ?? [],
    openRuns: runs.filter((r) => r.machineId === loom.id).map((r) => ({ itemId: r.weavingOrder?.itemId ?? r.itemId, weaveDesignId: r.weavingOrder?.weaveDesignId ?? null })),
  }, stock, target)).sort(compareCandidates);
  return out;
}
