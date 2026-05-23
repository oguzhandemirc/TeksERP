import { z } from "zod";
import { ItemType } from "@/types/enums";

const itemTypeEnum = z.enum(
  [ItemType.FABRIC, ItemType.YARN, ItemType.WARP, ItemType.CONSUMABLE],
  { message: "Ürün tipi seçilmeli" },
);

export const itemFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Ürün kodu boş bırakılamaz")
    .max(64, "Ürün kodu en fazla 64 karakter olabilir"),
  name: z
    .string()
    .trim()
    .min(1, "Ürün adı boş bırakılamaz")
    .max(200, "Ürün adı en fazla 200 karakter olabilir"),
  itemType: itemTypeEnum,
  unit: z
    .string()
    .min(1, "Birim boş bırakılamaz")
    .max(10, "Birim en fazla 10 karakter olabilir"),
  isActive: z.boolean(),
  allowedColorIds: z.array(z.string()),
  allowedPropertyIds: z.array(z.string()),
});

export type ItemFormValues = z.infer<typeof itemFormSchema>;

export const itemFormDefaults: ItemFormValues = {
  code: "",
  name: "",
  itemType: ItemType.FABRIC,
  unit: "MT",
  isActive: true,
  allowedColorIds: [],
  allowedPropertyIds: [],
};
