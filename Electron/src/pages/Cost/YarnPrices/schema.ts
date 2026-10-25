// Panel metin alanı tavanları — `max(n)` = `@db.VarChar(n)` (`schema-varchar-mirror.test.ts` ölçer).
import { z } from "zod";

export const yarnPriceTextSchema = z.object({
  note: z.string().max(300, "Not en fazla 300 karakter"),
});
export const YARN_NOTE_MAX = yarnPriceTextSchema.shape.note.maxLength ?? 300;
