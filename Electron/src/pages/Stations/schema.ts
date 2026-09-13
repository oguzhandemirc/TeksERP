import { z } from "zod";
import { StationKind, StationType } from "@/types/enums";

export const stationFormSchema = z.object({
  // Sınırlar DB kolonlarıyla birebir (Station.name @db.VarChar(100),
  // department @db.VarChar(32)) — panel şeması tek doğrulama kapısı; gevşek
  // sınır net 400 yerine sessiz P2000 üretirdi.
  name: z
    .string()
    .trim()
    .min(1, "İstasyon adı boş bırakılamaz")
    .max(100, "İstasyon adı en fazla 100 karakter olabilir"),
  type: z.enum([StationType.INTERNAL, StationType.EXTERNAL], {
    message: "İstasyon tipi seçilmeli",
  }),
  kind: z.enum(
    [
      StationKind.RAW_QC,
      StationKind.PROCESS_QC,
      StationKind.TAMBUR,
      StationKind.SUBCONTRACTOR,
      StationKind.SHIPPING,
      StationKind.OTHER,
      StationKind.WEAVING,
    ],
    { message: "İstasyon türü seçilmeli" },
  ),
  department: z
    .string()
    .max(32, "Bölüm adı en fazla 32 karakter olabilir")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
  // Yetenek bayrakları — HER TİPTE sorulur (iç istasyon da renk/özellik verebilir).
  appliesColor: z.boolean(),
  appliesProperty: z.boolean(),
  appliesQuality: z.boolean(),
  defaultCategoryId: z.string().nullable().optional(),
});

export type StationFormValues = z.infer<typeof stationFormSchema>;

export const stationFormDefaults: StationFormValues = {
  name: "",
  type: StationType.INTERNAL,
  kind: StationKind.OTHER,
  department: "",
  isActive: true,
  // Varsayılan: renk KAPALI, özellik AÇIK — backend kolon varsayılanlarıyla aynı.
  // Renk için "kapalı" güvenli taraf: yanlışlıkla Tambur adımına renk atanmasın.
  appliesColor: false,
  appliesProperty: true,
  // Kalite varsayılanı KAPALI — backend kolon varsayılanıyla aynı. Kalite bir
  // istisnadır: yeni istasyon sessizce KK yürütür hale gelmemeli.
  appliesQuality: false,
  defaultCategoryId: null,
};
