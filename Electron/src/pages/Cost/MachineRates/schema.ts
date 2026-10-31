// Panel metin alanı tavanları — `max(n)` = `@db.VarChar(n)` (`schema-varchar-mirror.test.ts` ölçer).
import { z } from "zod";

export const machineRateTextSchema = z.object({
  note: z.string().max(300, "Not en fazla 300 karakter"),
});
export const MACHINE_RATE_NOTE_MAX = machineRateTextSchema.shape.note.maxLength ?? 300;
