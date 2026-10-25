// Panel metin alanı tavanları — `max(n)` = `@db.VarChar(n)` (`schema-varchar-mirror.test.ts` ölçer).
import { z } from "zod";

export const costParamTextSchema = z.object({
  note: z.string().max(300, "Not en fazla 300 karakter"),
});
export const PARAM_NOTE_MAX = costParamTextSchema.shape.note.maxLength ?? 300;
