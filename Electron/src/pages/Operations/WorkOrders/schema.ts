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
  routeTemplateId: "",
  targetItemId: null,
  targetColorId: null,
  targetPropertyIds: [],
  orderLineIds: [],
  width: null,
  targetQuantity: null,
  plannedStartDate: "",
  plannedEndDate: "",
  foldType: "",
};
