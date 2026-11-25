import { z } from "zod";

/** Ad sınırı sunucuyla aynı: kumaş türü 60, lif türü 40; kısaltma 8. */
export function classTypeSchema(nameMax: number) {
  return z.object({
    name: z.string().trim().min(1, "Ad boş bırakılamaz").max(nameMax, `Ad en fazla ${nameMax} karakter olabilir`),
    abbreviation: z.string().trim().max(8, "Kısaltma en fazla 8 karakter olabilir"),
    sortOrder: z.string().trim().regex(/^\d{0,4}$/, "Sıra 0–9999 arası tam sayı olmalı"),
    isActive: z.boolean(),
  });
}

export type ClassTypeFormValues = z.infer<ReturnType<typeof classTypeSchema>>;

export const classTypeDefaults: ClassTypeFormValues = { name: "", abbreviation: "", sortOrder: "", isActive: true };

/** Form → gövde; kısaltma yalnız lif türünde gider (boş = null, kompozisyonda ad yazılır). */
export function classTypePayload(withAbbreviation: boolean, v: ClassTypeFormValues) {
  return {
    name: v.name.trim(),
    sortOrder: v.sortOrder === "" ? 0 : Number(v.sortOrder),
    isActive: v.isActive,
    ...(withAbbreviation ? { abbreviation: v.abbreviation.trim() || null } : {}),
  };
}
