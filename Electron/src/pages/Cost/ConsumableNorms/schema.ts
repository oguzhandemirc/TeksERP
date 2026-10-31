// Panel metin alanı tavanları — `max(n)` = `@db.VarChar(n)` (`schema-varchar-mirror.test.ts` ölçer).
import { z } from "zod";

export const consumableNormTextSchema = z.object({
  note: z.string().max(300, "Not en fazla 300 karakter"),
});
export const CONSUMABLE_NORM_NOTE_MAX = consumableNormTextSchema.shape.note.maxLength ?? 300;
