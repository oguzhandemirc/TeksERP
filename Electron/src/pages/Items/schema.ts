import { z } from "zod";
import { ItemType } from "@/types/enums";

const itemTypeEnum = z.enum(
  [ItemType.FABRIC, ItemType.YARN, ItemType.CONSUMABLE],
  { message: "Kumaş tipi seçilmeli" },
);

/** Backend `validateCode` + DB VarChar(32) ile hizalı. Boş = otomatik STK- kodu;
 * STK- öneki otomatik sayaca ayrılmıştır, manuel girilemez. */
const createCodeSchema = z
  .string()
  .trim()
  .max(32, "Kumaş kodu en fazla 32 karakter olabilir")
  .regex(/^[A-Za-z0-9_-]*$/, "Kod sadece harf, rakam, tire (-) ve alt çizgi (_) içerebilir")
  .refine(
    (v) => !/^stk-/i.test(v),
    "STK- öneki otomatik stok kodlarına ayrılmıştır — boş bırakın, sistem versin",
  );

/**
 * Edit'te kod salt-okunur ve payload'a girmez — validasyon uygulanmaz ki
 * validator öncesi girilmiş legacy bir kod düzenlemeyi bloklamasın.
 */
export const makeItemFormSchema = (isEdit: boolean) =>
  z.object({
    code: isEdit ? z.string() : createCodeSchema,
    name: z
      .string()
      .trim()
      .min(1, "Kumaş adı boş bırakılamaz")
      .max(100, "Kumaş adı en fazla 100 karakter olabilir"),
    itemType: itemTypeEnum,
    unit: z
      .string()
      .min(1, "Birim boş bırakılamaz")
      .max(10, "Birim en fazla 10 karakter olabilir"),
    /**
     * İplik inceliği (denye) — `Item.linearDensityDen`, DB `Decimal(10,4)`.
     * Çözgü kartı bunu ZORUNLU ister (kg = uç × denye × metre / 9.000.000) ama
     * kalem kartı istemez: mevcut iplik kayıtları boş doğdu ve zorunlu yapmak
     * onların düzenlenmesini kilitlerdi. Metin taşınır — Decimal kolona JS
     * float yazmak yasak.
     */
    linearDensityDen: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) > 0),
        "Denye pozitif bir sayı olmalı",
      )
      .refine(
        (v) => v === "" || /^\d+(\.\d{1,4})?$/.test(v),
        "Denye en fazla 4 ondalık basamak taşıyabilir",
      ),
    /** Kumaşın varsayılan çözgü kartı (E4) — yalnız FABRIC'te çizilir, boş = kartsız. */
    warpSpecId: z.string(),
    allowedColorIds: z.array(z.string()),
    allowedPropertyIds: z.array(z.string()),
  });

export type ItemFormValues = z.infer<ReturnType<typeof makeItemFormSchema>>;

export const itemFormDefaults: ItemFormValues = {
  code: "",
  name: "",
  itemType: ItemType.FABRIC,
  unit: "MT",
  linearDensityDen: "",
  warpSpecId: "",
  allowedColorIds: [],
  allowedPropertyIds: [],
};
