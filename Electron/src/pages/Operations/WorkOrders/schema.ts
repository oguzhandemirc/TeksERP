import { z } from "zod";
import { WorkOrderType } from "@/types/enums";

export const workOrderStepSchema = z.object({
  id: z.string().uuid().optional(),
  stationId: z.string().min(1, "İstasyon seçilmeli"),
  sequence: z.coerce.number().int().min(1, "Sıra numarası 1 veya daha büyük olmalı"),
  notes: z
    .string()
    .max(500, "Not en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
  requiredCategoryId: z.string().nullable().optional(),
  plannedSubcontractorId: z.string().nullable().optional(),
});

export type WorkOrderStepFormValues = z.infer<typeof workOrderStepSchema>;

export const workOrderFormSchema = z.object({
  type: z.enum(
    [WorkOrderType.ORDER_PRODUCTION, WorkOrderType.STOCK_PRODUCTION],
    { message: "İş emri tipi seçilmeli" },
  ),
  // Parti Kodu (backend: batchNumber). Zorunluluk runtime'da (manuel mod / override /
  // düzenleme) form submit'inde uygulanır; boş = otomatik üret (otomatik mod).
  batchNumber: z
    .string()
    .max(64, "Parti kodu en fazla 64 karakter olabilir")
    .optional()
    .or(z.literal("")),
  routeTemplateId: z.string().optional().default(""),
  targetItemId: z.string().nullable().optional(),
  targetColorId: z.string().nullable().optional(),
  targetPropertyIds: z.array(z.string()).optional().default([]),
  orderLineIds: z.array(z.string()).optional().default([]),
  width: z
    .union([
      z.coerce.number().positive("En 0'dan büyük olmalı"),
      z.literal("").transform(() => null),
      z.null(),
    ])
    .optional()
    .nullable(),
  targetQuantity: z
    .union([
      z.coerce.number().positive("Hedef miktar 0'dan büyük olmalı"),
      z.literal("").transform(() => null),
      z.null(),
    ])
    .optional()
    .nullable(),
  targetWeight: z
    .union([
      z.coerce.number().positive("Hedef ağırlık 0'dan büyük olmalı"),
      z.literal("").transform(() => null),
      z.null(),
    ])
    .optional()
    .nullable(),
  plannedStartDate: z.string().optional().or(z.literal("")),
  plannedEndDate: z.string().optional().or(z.literal("")),
  foldType: z
    .string()
    .max(32, "Katlama tipi en fazla 32 karakter olabilir")
    .optional()
    .or(z.literal("")),
});

export type WorkOrderFormValues = z.infer<typeof workOrderFormSchema>;

export const workOrderFormDefaults: WorkOrderFormValues = {
  type: WorkOrderType.ORDER_PRODUCTION,
  batchNumber: "",
  routeTemplateId: "",
  targetItemId: null,
  targetColorId: null,
  targetPropertyIds: [],
  orderLineIds: [],
  width: null,
  targetQuantity: null,
  targetWeight: null,
  plannedStartDate: "",
  plannedEndDate: "",
  // Kat tipi her iş emrinde belirli olmalı. ⚠️ Varsayılan BOŞ — eskiden burada
  // "2-KAT" sabiti vardı ve kat kataloğa taşındıktan sonra (2026-08-10) bu,
  // katalogunda 2-KAT OLMAYAN bir fabrikada geçersiz bir ön-seçim demekti
  // (kullanıcı hiç dokunmadan kaydeder, backend katalog doğrulamasıyla 400).
  // Ön-seçim artık formda, katalogun İLK değeriyle yapılır.
  foldType: "",
};
