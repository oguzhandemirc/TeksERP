import { z } from "zod";
import { ItemType } from "@/types/enums";

const itemTypeEnum = z.enum([
  ItemType.YARN,
  ItemType.WARP,
  ItemType.RAW_FABRIC,
  ItemType.DYED_FABRIC,
  ItemType.CONSUMABLE,
]);

export const itemFormSchema = z
  .object({
    mode: z.enum(["ham", "final"]),
    // Ham alanları
    code: z.string().max(64).optional().or(z.literal("")),
    itemType: itemTypeEnum.optional(),
    // Final alanları
    baseItemId: z.string().nullable().optional(),
    colorId: z.string().nullable().optional(),
    /** Final için Item.allowedProperties — opsiyonel; boş = tüm özellikler serbest. */
    allowedPropertyIds: z.array(z.string()).optional(),
    // Ortak
    name: z.string().max(200).optional().or(z.literal("")),
    unit: z.string().min(1, "Birim gerekli").max(10),
    isActive: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.mode === "ham") {
      if (!d.code || !d.code.trim()) {
        ctx.addIssue({ code: "custom", path: ["code"], message: "Kod gerekli" });
      }
      if (!d.name || !d.name.trim()) {
        ctx.addIssue({ code: "custom", path: ["name"], message: "Ad gerekli" });
      }
      if (!d.itemType) {
        ctx.addIssue({ code: "custom", path: ["itemType"], message: "Tip gerekli" });
      }
    } else {
      if (!d.baseItemId) {
        ctx.addIssue({
          code: "custom",
          path: ["baseItemId"],
          message: "Temel (ham) ürün seçin",
        });
      }
      if (!d.colorId) {
        ctx.addIssue({
          code: "custom",
          path: ["colorId"],
          message: "Renk seçin",
        });
      }
    }
  });

export type ItemFormValues = z.infer<typeof itemFormSchema>;

export const itemFormDefaults: ItemFormValues = {
  mode: "ham",
  code: "",
  itemType: ItemType.RAW_FABRIC,
  baseItemId: null,
  colorId: null,
  allowedPropertyIds: [],
  name: "",
  unit: "MT",
  isActive: true,
};

export const finalItemFormDefaults: ItemFormValues = {
  ...itemFormDefaults,
  mode: "final",
};

/**
 * Türetilmiş code önizlemesi — backend'in `buildDerivedItemCode` ile aynı
 * mantık. Sadece (baseCode, colorCode) — özellikler kimliği etkilemez.
 */
export function previewDerivedCode(
  baseCode: string | undefined,
  colorCode: string | null | undefined,
): string {
  if (!baseCode) return "";
  return colorCode ? `${baseCode}-${colorCode}` : baseCode;
}

export function previewDerivedName(
  baseName: string | undefined,
  colorName: string | null | undefined,
): string {
  if (!baseName) return "";
  return colorName ? `${baseName} ${colorName}` : baseName;
}
