// Panel metin alanı tavanları — `max(n)` = `@db.VarChar(n)` (`schema-varchar-mirror.test.ts` ölçer).
import { z } from "zod";

export const finishingRateTextSchema = z.object({
  code: z.string().max(32, "Kod en fazla 32 karakter"),
  name: z.string().max(100, "Ad en fazla 100 karakter"),
  note: z.string().max(300, "Not en fazla 300 karakter"),
});
const sh = finishingRateTextSchema.shape;
export const FINISHING_MAX = { code: sh.code.maxLength ?? 32, name: sh.name.maxLength ?? 100, note: sh.note.maxLength ?? 300 };
