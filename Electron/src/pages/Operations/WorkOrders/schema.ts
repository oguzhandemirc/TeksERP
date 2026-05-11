import { z } from "zod";
import { WorkOrderType } from "@/types/enums";

export const workOrderFormSchema = z.object({
  type: z.enum([
    WorkOrderType.ORDER_PRODUCTION,
    WorkOrderType.STOCK_PRODUCTION,
    WorkOrderType.SAMPLE_PRODUCTION,
    WorkOrderType.REPAIR_REWORK,
  ]),
  // Boş bırakılabilir: form'da customSteps doluysa kabul edilir (form-seviyesinde kontrol).
  routeTemplateId: z.string().optional().default(""),
  targetItemId: z.string().nullable().optional(),
  targetPropertyIds: z.array(z.string()).optional().default([]),
  orderLineIds: z.array(z.string()).optional().default([]),
  width: z.union([z.coerce.number().positive(), z.literal("").transform(() => null), z.null()]).optional().nullable(),
  targetQuantity: z.union([z.coerce.number().positive(), z.literal("").transform(() => null), z.null()]).optional().nullable(),
  recipeNo: z.string().max(100).optional().or(z.literal("")),
  plannedStartDate: z.string().optional().or(z.literal("")),
  plannedEndDate: z.string().optional().or(z.literal("")),
});

export type WorkOrderFormValues = z.infer<typeof workOrderFormSchema>;

export const workOrderFormDefaults: WorkOrderFormValues = {
  type: WorkOrderType.ORDER_PRODUCTION,
  routeTemplateId: "",
  targetItemId: null,
  targetPropertyIds: [],
  orderLineIds: [],
  width: null,
  targetQuantity: null,
  recipeNo: "",
  plannedStartDate: "",
  plannedEndDate: "",
};
