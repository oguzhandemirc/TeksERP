import { z } from "zod";
import { StationKind, StationType } from "@/types/enums";

export const stationFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "İstasyon adı boş bırakılamaz")
    .max(120, "İstasyon adı en fazla 120 karakter olabilir"),
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
    ],
    { message: "İstasyon türü seçilmeli" },
  ),
  department: z
    .string()
    .max(60, "Bölüm adı en fazla 60 karakter olabilir")
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
