import { z } from "zod";

export const fabricPropertyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Özellik adı boş bırakılamaz")
    .max(80, "Özellik adı en fazla 80 karakter olabilir"),
  category: z
    .string()
    .max(60, "Kategori adı en fazla 60 karakter olabilir")
    .optional()
    .or(z.literal("")),
  description: z
    .string()
    .max(300, "Açıklama en fazla 300 karakter olabilir")
    .optional()
    .or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk kodu #RRGGBB formatında olmalı (örn. #1A2B3C)")
    .optional()
    .or(z.literal("")),
  // Özelliği uygulayacak istasyon(lar) — ZORUNLU. Backend de reddeder; buradaki
  // kural istemci tarafındaki ikizi, gevşetme (bkz. PropertyStationsField).
  stationIds: z
    .array(z.string())
    .min(1, "Özelliği uygulayacak en az bir istasyon seçilmeli"),
  // BAYRAK (var/yok) mı, SEÇİM (değerlerden biri — kat gibi) mi?
  valueType: z.enum(["FLAG", "CHOICE"]),
  // SEÇİM tipliyse izin verilen değerler. Kod KİMLİKTİR ve ASCII olmalı:
  // "TÜP" kodu, ASCII yazan her istemciyi ("TUP") sessizce reddettirir.
  // Backend aynı kuralı uygular — buradaki kural onun istemci ikizi.
  values: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .min(1, "Kod boş olamaz")
          .max(32, "Kod en fazla 32 karakter")
          .regex(
            /^[\x20-\x7E]+$/,
            "Kodda Türkçe karakter olamaz — kod kimliktir (örn. TUP); Türkçe yazım Ad alanına",
          ),
        name: z.string().trim().min(1, "Ad boş olamaz").max(100, "Ad en fazla 100 karakter"),
        isActive: z.boolean(),
      }),
    )
    .default([]),
  isActive: z.boolean(),
}).superRefine((v, ctx) => {
  // SEÇİM tipli özellik DEĞERSİZ doğamaz — `stationIds`siz özelliğin ikizi:
  // tanımlı ama hiçbir ekranda seçilemez. Backend de reddeder.
  if (v.valueType === "CHOICE" && v.values.filter((x) => x.isActive).length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["values"],
      message: "Seçim tipli özellik en az bir AKTİF değer taşımalı",
    });
  }
  const codes = v.values.map((x) => x.code.trim().toUpperCase());
  const dup = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dup) {
    ctx.addIssue({ code: "custom", path: ["values"], message: `'${dup}' kodu iki kez girilmiş` });
  }
});

export type FabricPropertyFormValues = z.infer<typeof fabricPropertyFormSchema>;

export const fabricPropertyFormDefaults: FabricPropertyFormValues = {
  name: "",
  category: "",
  description: "",
  color: "",
  stationIds: [],
  valueType: "FLAG",
  values: [],
  isActive: true,
};
