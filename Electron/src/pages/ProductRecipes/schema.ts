import { z } from "zod";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";

// Alan adları bilinçli olarak WorkOrderFormValues ile aynı (targetItemId vb.) —
// böylece WO formundaki hedef ürün/renk/özellik picker'ları aynen yeniden
// kullanılabiliyor (ProductRecipeFormDialog control cast'i ile).
export const recipeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Reçete adı boş bırakılamaz")
    .max(100, "En fazla 100 karakter"),
  targetItemId: z.string().nullable().optional(),
  targetColorId: z.string().nullable().optional(),
  targetPropertyIds: z.array(z.string()).optional().default([]),
  routeTemplateId: z.string().optional().default(""),
  width: z
    .union([
      z.coerce.number().positive("En 0'dan büyük olmalı"),
      z.literal("").transform(() => null),
      z.null(),
    ])
    .optional()
    .nullable(),
  foldType: z
    .string()
    .max(32, "Kat tipi en fazla 32 karakter")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
});

export type RecipeFormValues = z.infer<typeof recipeFormSchema>;

export const recipeFormDefaults: RecipeFormValues = {
  name: "",
  targetItemId: null,
  targetColorId: null,
  targetPropertyIds: [],
  routeTemplateId: "",
  width: null,
  foldType: "",
  isActive: true,
};

export function generateRecipeCode(): string {
  return generateCode(CODE_PREFIXES.RECIPE);
}
