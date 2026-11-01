// =============================================================================
// TEKLİF KALEMİ MALİYETİ — kalemin TL/m maliyeti + donan fotoğrafı (MAL-4; plan §4.3 adım 1)
// =============================================================================
// Ürünlü kalem: aktif standart sürüm (saklanan döküm, yeniden hesap YOK) → yoksa canlı hesap + uyarı
// STANDARD_COST_MISSING. Elle yapı ("yeni desen"): derleyici + motor. Eksik girdi → 400 COST_INPUT_MISSING
// (kur yoksa FX_RATE_MISSING — 1 VARSAYILMAZ). Fotoğraf KATI şemadır (`schemaVersion: 1`): kalem yazıldığı
// an donar, "tazele" yalnız DRAFT'ta yeniden kurar.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { assembleCostInputTx, type CostSourceRef } from "./cost-assembler.helper";
import { computeFabricCost, roundCost4, type CostInput } from "./fabric-cost.helper";
import { costInputSnapshotSchema, fxRatesSnapshotSchema, parseCostInputSnapshot, serializeCostInput } from "./cost-snapshot.helper";
import { resolveFx } from "../cost-calc.service";

const dec = z.string().regex(/^-?\d+(\.\d+)?$/, "Decimal metin bekleniyor");

export const quoteCostSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    kaynak: z.enum(["STANDART", "CANLI", "ELLE_YAPI"]),
    standardCostVersionId: z.string().uuid().nullable(),
    surumNo: z.number().int().nullable(),
    standartTlM: dec,
    girdi: costInputSnapshotSchema,
    kurlar: fxRatesSnapshotSchema,
    uyarilar: z.array(z.string()),
  })
  .strict();
export type QuoteCostSnapshot = z.infer<typeof quoteCostSnapshotSchema>;

export interface QuoteLineCost {
  costPerMTry: Prisma.Decimal;
  standardCostVersionId: string | null;
  snapshot: QuoteCostSnapshot;
  warnings: string[];
}

const missingError = (missing: string[]) =>
  AppError.badRequest("Maliyet girdisi eksik; teklif kalemi fiyatlanamaz.", { code: "COST_INPUT_MISSING", missing });

/** Canlı hesap (motor): girdi + kur fotoğrafı; eksik → 400. */
async function liveCost(input: CostInput, kaynak: "CANLI" | "ELLE_YAPI", extraWarnings: string[]): Promise<QuoteLineCost> {
  const fx = await resolveFx(input, {});
  const out = computeFabricCost(input, fx.rates);
  if (!out.result) throw missingError(out.missing);
  const warnings = [...extraWarnings, ...out.warnings];
  const costPerMTry = roundCost4(out.result.totalCostPerMTry);
  return {
    costPerMTry,
    standardCostVersionId: null,
    warnings,
    snapshot: quoteCostSnapshotSchema.parse({
      schemaVersion: 1, kaynak, standardCostVersionId: null, surumNo: null, standartTlM: costPerMTry.toFixed(4),
      girdi: serializeCostInput(input), kurlar: fx.snapshot, uyarilar: warnings,
    }),
  };
}

/**
 * Ürünlü ya da elle yapılı kalemin maliyeti (tx DIŞINDA okunur; kalem yazımı ayrı tx'te). Varyantlı kalem (SY-N1)
 * yalnız KENDİ varyant sürümünü okur; yoksa varyantla canlı hesap — desen geneli sürüme düşmez (iplik/tarife farklı).
 */
export async function resolveQuoteLineCost(ref: CostSourceRef): Promise<QuoteLineCost> {
  if ("itemId" in ref) {
    const v = await prisma.standardCostVersion.findFirst({
      where: { itemId: ref.itemId, recipeId: ref.recipeId ?? null, status: "ACTIVE" },
      select: { id: true, versionNo: true, totalCostPerMTry: true, inputSnapshot: true, fxRates: true, warnings: true },
    });
    if (v) {
      const warnings = Array.isArray(v.warnings) ? (v.warnings as unknown[]).map(String) : [];
      return {
        costPerMTry: v.totalCostPerMTry,
        standardCostVersionId: v.id,
        warnings,
        snapshot: quoteCostSnapshotSchema.parse({
          schemaVersion: 1, kaynak: "STANDART", standardCostVersionId: v.id, surumNo: v.versionNo, standartTlM: v.totalCostPerMTry.toFixed(4),
          girdi: costInputSnapshotSchema.parse(v.inputSnapshot), kurlar: fxRatesSnapshotSchema.parse(v.fxRates), uyarilar: warnings,
        }),
      };
    }
  }
  const input = await prisma.$transaction((tx) => assembleCostInputTx(tx, ref));
  return liveCost(input, "itemId" in ref ? "CANLI" : "ELLE_YAPI", "itemId" in ref ? ["STANDARD_COST_MISSING"] : []);
}

/** "Maliyeti tazele": ürünlü kalem yeniden çözülür; elle yapı donmuş girdiyle bugünkü kurdan yeniden hesaplanır. */
export async function refreshQuoteLineCost(line: { itemId: string | null; recipeId?: string | null; costSnapshot: Prisma.JsonValue }): Promise<QuoteLineCost> {
  if (line.itemId) return resolveQuoteLineCost(line.recipeId ? { itemId: line.itemId, recipeId: line.recipeId } : { itemId: line.itemId });
  const snap = quoteCostSnapshotSchema.parse(line.costSnapshot);
  return liveCost(parseCostInputSnapshot(snap.girdi), "ELLE_YAPI", []);
}
