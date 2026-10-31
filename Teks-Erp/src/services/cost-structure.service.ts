// =============================================================================
// ÜRÜN MALİYET YAPISI (CostStructure) — MAL-1
// =============================================================================
// KATALOG (canlı ayar): ürün yapısının TEK kaynağı dokuma kartlarıdır (`WarpSpec`,
// `WeftSpec`); burada yalnız kartta OLMAYANLAR durur (devir, randıman, fire, atkı boyu,
// tarife kodu…). Her alan NULL = parametre varsayılanı. Parasal sonuç standart maliyet
// sürümünde donar (MAL-2); yapı değişimi geçmiş sürümü değiştirmez. Yalnız KUMAŞ.
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { EFFICIENCY_RULE, PCT_RULE, isUniqueViolation, parseDecimalField, parsePickRatePair, parseTextField, type DecimalRule } from "./helpers/cost-input.helper";
import { normalizeFinishingRateCode, resolveActiveFinishingRate } from "./finishing-rate.service";

export const COST_STRUCTURE_SELECT = {
  id: true,
  itemId: true,
  loomRpm: true,
  efficiencyPct: true,
  warpWastePct: true,
  weftWastePct: true,
  fabricWastePct: true,
  weftLengthCm: true,
  beamLengthM: true,
  finishingRateCode: true,
  lengthShrinkPct: true,
  extraCostPerMTry: true,
  extraCostLabel: true,
  loomPickRate: true,
  loomPickCurrency: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
} satisfies Prisma.CostStructureSelect;

export type CostStructureRow = Prisma.CostStructureGetPayload<{ select: typeof COST_STRUCTURE_SELECT }>;

const NUMERIC: Record<string, DecimalRule> = {
  loomRpm: { label: "Tezgah devri", min: 0, minExclusive: true, scale: 0, integer: true },
  efficiencyPct: EFFICIENCY_RULE("Randıman"),
  warpWastePct: PCT_RULE("Çözgü firesi"),
  weftWastePct: PCT_RULE("Atkı firesi"),
  fabricWastePct: PCT_RULE("Kalite firesi"),
  weftLengthCm: { label: "Atkı boyu (cm)", min: 0, minExclusive: true, scale: 2 },
  beamLengthM: { label: "Levent boyu (m)", min: 0, minExclusive: true, scale: 2 },
  lengthShrinkPct: PCT_RULE("Boy çekmesi"),
  extraCostPerMTry: { label: "Ek maliyet (TL/m)", min: 0, scale: 4 },
};
const TEXT: Record<string, { label: string; max: number }> = {
  extraCostLabel: { label: "Ek maliyet etiketi", max: 100 },
  notes: { label: "Not", max: 500 },
};

/** Ürünün yapısı + kartı (FABRIC değilse de okunur; yazma kapısı servis 400'üdür). */
export async function getCostStructure(itemId: string): Promise<{ itemId: string; structure: CostStructureRow | null }> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  const structure = await prisma.costStructure.findUnique({ where: { itemId }, select: COST_STRUCTURE_SELECT });
  return { itemId, structure };
}

/** YAPIYI YAZ (PUT = tam küme): gönderilmeyen alan NULL'a döner (parametre varsayılanı); atkı ücreti çifti istisna (gönderilmezse korunur). */
export async function putCostStructure(itemId: string, body: Record<string, unknown>, userId?: string): Promise<CostStructureRow> {
  const allowed = new Set([...Object.keys(NUMERIC), ...Object.keys(TEXT), "finishingRateCode", "loomPickRate", "loomPickCurrency"]);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan alan: ${unknown.join(", ")}`);

  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, name: true, itemType: true } });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  if (item.itemType !== ItemType.FABRIC) {
    throw AppError.badRequest(`"${item.name}" bir KUMAŞ kartı değil — maliyet yapısı yalnız kumaşa girilir.`, { code: "COST_STRUCTURE_FABRIC_ONLY" });
  }

  const data: Record<string, unknown> = {};
  for (const [k, rule] of Object.entries(NUMERIC)) {
    const v = parseDecimalField(body[k], rule) ?? null;
    data[k] = k === "loomRpm" && v !== null ? v.toNumber() : v;
  }
  for (const [k, t] of Object.entries(TEXT)) data[k] = parseTextField(body[k], t.label, t.max) ?? null;
  // Çift gövdede yoksa DOKUNULMAZ: alanları göndermeyen panel (SY-D4 öncesi/eski sürüm) ücreti silmesin.
  const pick = parsePickRatePair(body.loomPickRate, body.loomPickCurrency);
  if (pick !== undefined) {
    data.loomPickRate = pick.rate;
    data.loomPickCurrency = pick.currency;
  }

  const rawCode = body.finishingRateCode;
  if (rawCode === undefined || rawCode === null || rawCode === "") {
    data.finishingRateCode = null;
  } else {
    const code = normalizeFinishingRateCode(rawCode);
    // Kod AKTİF bir tarifeye çözülmeli: bilinmeyen/kaldırılmış kod sessizce "terbiyesiz" sayılmaz.
    if (!(await resolveActiveFinishingRate(code))) {
      throw AppError.badRequest(`"${code}" kodlu yürürlükte bir terbiye tarifesi yok.`, { code: "COST_FINISHING_RATE_UNKNOWN" });
    }
    data.finishingRateCode = code;
  }

  const before = await prisma.costStructure.findUnique({ where: { itemId }, select: COST_STRUCTURE_SELECT });
  let row: CostStructureRow;
  try {
    row = await prisma.costStructure.upsert({
      where: { itemId },
      create: { ...(data as Omit<Prisma.CostStructureUncheckedCreateInput, "itemId">), itemId, createdById: userId ?? null, updatedById: userId ?? null },
      update: { ...(data as Prisma.CostStructureUncheckedUpdateInput), updatedById: userId ?? null },
      select: COST_STRUCTURE_SELECT,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict("Maliyet yapısı aynı anda başka bir işlemle yazıldı — tekrar deneyin.");
    throw e;
  }
  const snap = (r: CostStructureRow | null): Record<string, unknown> | null =>
    r ? Object.fromEntries(Object.keys(data).map((k) => [k, r[k as keyof CostStructureRow] === null ? null : String(r[k as keyof CostStructureRow])])) : null;
  void AuditService.log({
    userId,
    action: before ? "UPDATE" : "CREATE",
    tableName: "COST_STRUCTURE",
    recordId: row.id,
    oldData: snap(before),
    newData: { itemId, ...snap(row) },
  });
  return row;
}
