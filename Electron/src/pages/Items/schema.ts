import { z } from "zod";
import { ItemType } from "@/types/enums";
import { acceptNumberAsText } from "@/lib/decimal-form-text";

/** Dokuma ayrıntısı sayısı — Decimal(·,2) metin taşınır, virgül kabul, "" = boş; `max` kolon tavanı. */
const positiveDecimalText = (label: string, max: number) =>
  acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d+([.,]\d{1,2})?$/.test(v), `${label} sayı olmalı (en fazla 2 ondalık)`)
      .refine((v) => v === "" || Number(v.replace(",", ".")) > 0, `${label} sıfırdan büyük olmalı`)
      .refine((v) => v === "" || Number(v.replace(",", ".")) < max, `${label} çok büyük`),
  );

const itemTypeEnum = z.enum(
  // Hizmet kartı ayrı tabloda (`/api/service-items`) — ürün kartı formu SERVICE sunmaz.
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
    linearDensityDen: acceptNumberAsText(
      z
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
    ),
    /**
     * K4P ürün kartı eni (cm) — `Item.widthCm` Decimal(8,2); muayene puan/100 m² bu enden. Metin taşınır
     * (Decimal'e float yazılmaz); virgül kabul, "" = en yok. Yalnız Kalite Güvence açıkken çizilir.
     */
    widthCm: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d+([.,]\d{1,2})?$/.test(v), "En sayı olmalı (en fazla 2 ondalık)")
      .refine((v) => v === "" || Number(v.replace(",", ".")) > 0, "En sıfırdan büyük olmalı"),
    /** SY-3 I2: iplik firesi % (yalnız İPLİK) — backend 0..50, en çok 2 ondalık (`Decimal(5,2)`); "" = kart zinciri. */
    yarnWastePct: acceptNumberAsText(
      z
        .string()
        .trim()
        .refine((v) => v === "" || /^\d+([.,]\d{1,2})?$/.test(v), "İplik firesi sayı olmalı (en fazla 2 ondalık)")
        .refine((v) => v === "" || Number(v.replace(",", ".")) <= 50, "İplik firesi en fazla %50 olabilir"),
    ),
    /** Dokuma ayrıntıları (yalnız KUMAŞ): ham en Decimal(6,2), gramajlar Decimal(7,2). */
    rawWidthCm: positiveDecimalText("Ham en", 10_000),
    rawGsm: positiveDecimalText("Ham gramaj", 100_000),
    finishedGsm: positiveDecimalText("Mamul gramaj", 100_000),
    /** Kumaşın varsayılan çözgü kartı (E4) — yalnız FABRIC'te çizilir, boş = kartsız. */
    warpSpecId: z.string(),
    /** SY-A4: atkı + desen kartı — yalnız KUMAŞ + dokuma açıkken çizilir, boş = kartsız. */
    weftSpecId: z.string(),
    weaveDesignId: z.string(),
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
  yarnWastePct: "",
  widthCm: "",
  rawWidthCm: "",
  rawGsm: "",
  finishedGsm: "",
  warpSpecId: "",
  weftSpecId: "",
  weaveDesignId: "",
  allowedColorIds: [],
  allowedPropertyIds: [],
};
