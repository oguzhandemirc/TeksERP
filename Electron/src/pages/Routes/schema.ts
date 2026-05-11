import { z } from "zod";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";

export const routeStepSchema = z.object({
  // İstemci tarafı geçici id (sortable key) — payload'a girmez
  clientId: z.string(),
  stationId: z.string().min(1, "İstasyon seç"),
  defaultNotes: z.string().max(500).optional().or(z.literal("")),
});

export const routeFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  customerId: z.string().nullable().optional(),
  isFavorite: z.boolean(),
  isActive: z.boolean(),
  steps: z.array(routeStepSchema).min(1, "En az bir adım gerekli"),
});

export type RouteStepFormValues = z.infer<typeof routeStepSchema>;
export type RouteFormValues = z.infer<typeof routeFormSchema>;

export const routeFormDefaults: RouteFormValues = {
  name: "",
  description: "",
  customerId: null,
  isFavorite: false,
  isActive: true,
  steps: [],
};

let counter = 0;
export function newClientId(): string {
  counter += 1;
  return `step-${Date.now()}-${counter}`;
}

export const generateRouteCode = (): string => generateCode(CODE_PREFIXES.ROUTE);
