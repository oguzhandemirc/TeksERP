// Panel metin alanı tavanları — `max(n)` = `@db.VarChar(n)` (`schema-varchar-mirror.test.ts` ölçer).
import { z } from "zod";

export const costStructureTextSchema = z.object({
  extraCostLabel: z.string().max(100, "Etiket en fazla 100 karakter"),
  notes: z.string().max(500, "Not en fazla 500 karakter"),
});
export const standardCostTextSchema = z.object({
  reason: z.string().max(300, "Gerekçe en fazla 300 karakter"),
});
export const STRUCTURE_MAX = {
  extraCostLabel: costStructureTextSchema.shape.extraCostLabel.maxLength ?? 100,
  notes: costStructureTextSchema.shape.notes.maxLength ?? 500,
  reason: standardCostTextSchema.shape.reason.maxLength ?? 300,
};

export const STRUCTURE_FIELDS = [
  { key: "loomRpm", label: "Tezgah devri", unit: "devir/dk" },
  { key: "efficiencyPct", label: "Randıman", unit: "%" },
  { key: "warpWastePct", label: "Çözgü firesi", unit: "%" },
  { key: "weftWastePct", label: "Atkı firesi", unit: "%" },
  { key: "fabricWastePct", label: "Kalite firesi", unit: "%" },
  { key: "weftLengthCm", label: "Atkı boyu", unit: "cm" },
  { key: "beamLengthM", label: "Levent çözgü boyu", unit: "m" },
  { key: "lengthShrinkPct", label: "Boy çekmesi", unit: "%" },
  { key: "extraCostPerMTry", label: "Ek kalem", unit: "TL/m" },
] as const;
