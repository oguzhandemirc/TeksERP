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
});

export const routeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Rota adı boş bırakılamaz")
    .max(120, "Rota adı en fazla 120 karakter olabilir"),
  description: z
    .string()
    .max(500, "Açıklama en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
  customerId: z.string().nullable().optional(),
  isFavorite: z.boolean(),
  isActive: z.boolean(),
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
  steps: [],
};

let counter = 0;
export function newClientId(): string {
  counter += 1;
  return `step-${Date.now()}-${counter}`;
}
