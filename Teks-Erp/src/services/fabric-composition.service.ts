// =============================================================================
// KUMAŞ KARTI — HESAPLANAN KOMPOZİSYON (K7, Seyitoğlu 2026-11-25; salt okuma)
// =============================================================================
// Yeni formül YOK: iplik başına kg/m maliyet motorunun `yarnUsagePerM(…, { includeWaste: false })`inden
// (hesaplanan gramajla aynı girdi `buildCostInput`). Lif payı = Σ(iplik kg × iplik lif payı) ÷ Σ kg.
// Eksik veri (çözgü/atkı çözülemedi, lif bileşimi girilmemiş iplik) → `parts`/`text` null = "bilinmiyor";
// 0 ya da tahmin yazılmaz. KG dışı birimli atkı ipliği (pul/payet) kg defterine girmediği için hesaba girmez.
// Elle düzeltme `Item.composition`: doluysa ekranda o gösterilir, bu uç yine hesaplananı döner.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildCostInput, loadCostStructureSourcesTx } from "./helpers/cost-assembler.helper";
import { yarnUsagePerM } from "./helpers/fabric-cost.helper";
import { pctText } from "./helpers/qty-text.helper";

type Dec = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export type CompositionStatus = "OK" | "NOT_FABRIC" | "MISSING_STRUCTURE" | "MISSING_FIBER";
export interface CompositionPart { fiberTypeId: string; name: string; abbreviation: string | null; pct: number }
export interface ComputedComposition {
  status: CompositionStatus;
  parts: CompositionPart[] | null;
  /** "%83 PES %17 VIS" — `parts` ile aynı sıra (büyükten küçüğe). */
  text: string | null;
  /** Elle düzeltme (`Item.composition`); null = yok. */
  manual: string | null;
  /** Lif bileşimi girilmemiş iplikler (MISSING_FIBER). */
  missingYarns: Array<{ id: string; code: string; name: string }>;
}

interface FiberShare { fiberTypeId: string; name: string; abbreviation: string | null; kg: Dec }

/** Tam sayı yüzdeler, toplam 100 (en büyük kalan yöntemi); 0'a yuvarlanan lif düşer. Eşitlikte ad sırası. */
export function roundShares(shares: FiberShare[]): CompositionPart[] {
  const total = shares.reduce((a, s) => a.plus(s.kg), ZERO);
  if (total.lte(0)) return [];
  const raw = shares.map((s) => {
    const exact = s.kg.div(total).mul(HUNDRED);
    const floor = exact.floor();
    return { s, floor: floor.toNumber(), rem: exact.minus(floor) };
  });
  let left = 100 - raw.reduce((a, r) => a + r.floor, 0);
  const byRem = [...raw].sort((a, b) => b.rem.comparedTo(a.rem) || a.s.name.localeCompare(b.s.name, "tr"));
  for (const r of byRem) {
    if (left <= 0) break;
    r.floor += 1;
    left -= 1;
  }
  return raw
    .filter((r) => r.floor > 0)
    .sort((a, b) => b.floor - a.floor || a.s.name.localeCompare(b.s.name, "tr"))
    .map((r) => ({ fiberTypeId: r.s.fiberTypeId, name: r.s.name, abbreviation: r.s.abbreviation, pct: r.floor }));
}

export const compositionText = (parts: CompositionPart[]): string => parts.map((p) => `%${pctText(p.pct, 0)} ${p.abbreviation ?? p.name}`).join(" ");

/** İplik başına net kg/m (çözgü zemini + ek katmanlar + atkı); çözülemeyen parça varsa null. */
function yarnKgMap(usage: ReturnType<typeof yarnUsagePerM>, layerCount: number): Map<string, Dec> | null {
  if (!usage.warp || usage.warpLayers.length !== layerCount || usage.weft.length === 0) return null;
  const all = [...usage.warp.yarns, ...usage.warpLayers.flatMap((l) => l.yarns), ...usage.weft];
  const out = new Map<string, Dec>();
  for (const y of all) {
    if (!y.yarnItemId) return null;
    out.set(y.yarnItemId, (out.get(y.yarnItemId) ?? ZERO).plus(y.kgPerM));
  }
  return out;
}

export async function computedCompositionForItem(itemId: string): Promise<ComputedComposition> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, itemType: true, composition: true } });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  const base = { manual: item.composition ?? null, parts: null, text: null, missingYarns: [] };
  if (item.itemType !== "FABRIC") return { ...base, status: "NOT_FABRIC" };
  const src = await loadCostStructureSourcesTx(prisma as unknown as Prisma.TransactionClient, [item.id]);
  const input = buildCostInput(src, { itemId: item.id });
  const kg = yarnKgMap(yarnUsagePerM(input, { includeWaste: false }), input.warpLayers?.length ?? 0);
  if (!kg) return { ...base, status: "MISSING_STRUCTURE" };
  const yarns = await prisma.item.findMany({
    where: { id: { in: [...kg.keys()] } },
    select: { id: true, code: true, name: true, fibers: { select: { pct: true, fiberType: { select: { id: true, name: true, abbreviation: true } } } } },
    orderBy: { code: "asc" },
  });
  const missing = yarns.filter((y) => y.fibers.length === 0).map(({ id, code, name }) => ({ id, code, name }));
  if (missing.length > 0) return { ...base, status: "MISSING_FIBER", missingYarns: missing };
  const shares = new Map<string, FiberShare>();
  for (const y of yarns) {
    const yarnKg = kg.get(y.id) ?? ZERO;
    for (const f of y.fibers) {
      const cur = shares.get(f.fiberType.id) ?? { fiberTypeId: f.fiberType.id, name: f.fiberType.name, abbreviation: f.fiberType.abbreviation, kg: ZERO };
      cur.kg = cur.kg.plus(yarnKg.mul(f.pct).div(HUNDRED));
      shares.set(f.fiberType.id, cur);
    }
  }
  const parts = roundShares([...shares.values()]);
  if (parts.length === 0) return { ...base, status: "MISSING_STRUCTURE" };
  return { ...base, status: "OK", parts, text: compositionText(parts) };
}
