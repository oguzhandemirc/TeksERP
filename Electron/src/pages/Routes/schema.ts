import { z } from "zod";

export const routeStepSchema = z.object({
  // İstemci tarafı geçici id (sortable key) — payload'a girmez
  clientId: z.string(),
  stationId: z.string().min(1, "İstasyon seçilmeli"),
  defaultNotes: z
    .string()
    .max(500, "Not en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
  // Saha #14: fason planlaması — EXTERNAL istasyonlarda rota ile birlikte saklanır.
  // stationType yalnız UI koşulu içindir (payload'a girmez); diğer ikisi persist olur.
  stationType: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  requiredCategoryId: z.string().nullable().optional(),
  plannedSubcontractorId: z.string().nullable().optional(),
  // Gülkesim 2026-11-02: kurşun adımına makine ÖNERİSİ (İE adımına klonlanır).
  // stationKind yalnız UI koşuludur (payload'a girmez).
  stationKind: z.string().nullable().optional(),
  plannedMachineId: z.string().nullable().optional(),
  // 2026-08-06: adımın şablon HEDEFİ. Rota iş emrine uygulanınca hedef renk /
  // özellik alanlarını ön-doldurur; boş bırakmak meşru (renksiz rota her renkte
  // yeniden kullanılır). İstasyonun gerçekten uygulayıp uygulayamadığı
  // `RouteStepTargets` ile sorulur, backend ikinci hat olarak doğrular.
  plannedColorId: z.string().nullable().optional(),
  plannedPropertyIds: z.array(z.string()).optional(),
});

export const routeFormSchema = z.object({
  // Sınır DB kolonuyla birebir (Route.name @db.VarChar(100)) — panel şeması
  // tek doğrulama kapısı; gevşek sınır sessiz P2000 üretirdi.
  name: z
    .string()
    .trim()
    .min(1, "Rota adı boş bırakılamaz")
    .max(100, "Rota adı en fazla 100 karakter olabilir"),
  description: z
    .string()
    .max(500, "Açıklama en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
  customerId: z.string().nullable().optional(),
  isFavorite: z.boolean(),
  isActive: z.boolean(),
  // İş emri kısayolu (K6); `shortcutKnown` gövdeye girmez — sunucu alanı tanıyor mu (eski backend).
  isWorkOrderShortcut: z.boolean(),
  shortcutOrder: z.number("Sıra sayı olmalı").int("Sıra tam sayı olmalı").min(0, "Sıra 0 ya da büyük olmalı").max(9999, "Sıra en çok 9999"),
  shortcutKnown: z.boolean(),
  steps: z
    .array(routeStepSchema)
    .min(1, "Rota en az bir adım içermeli"),
});

export type RouteStepFormValues = z.infer<typeof routeStepSchema>;
export type RouteFormValues = z.infer<typeof routeFormSchema>;

export const routeFormDefaults: RouteFormValues = {
  name: "",
  description: "",
  customerId: null,
  isFavorite: false,
  isActive: true,
  isWorkOrderShortcut: false,
  shortcutOrder: 0,
  shortcutKnown: false,
  steps: [],
};

let counter = 0;
export function newClientId(): string {
  counter += 1;
  return `step-${Date.now()}-${counter}`;
}
