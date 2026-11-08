// Fason F7b — iş emrinde "ana hammaddeyi kim verdi" (BU FABRİKANIN bakışı; giden fasondaki fasoncu bu
// kümede yoktur). Zod listesi ve okunur etiket TEK yerde; Prisma enum'u ile `satisfies` derlemede ölçülür.
import type { MaterialProvider } from "@prisma/client";

export const MATERIAL_PROVIDERS = ["CUSTOMER", "US", "MIXED"] as const satisfies readonly MaterialProvider[];

/** Hareket defteri etiketi (panel aynası `Electron/src/types/enums.ts` `materialProviderLabels`). */
export const MATERIAL_PROVIDER_LABEL: Record<MaterialProvider, string> = {
  CUSTOMER: "Müşteri verdi",
  US: "Bu fabrika verdi",
  MIXED: "Karışık (müşteri + bu fabrika)",
};
