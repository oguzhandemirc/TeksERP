// Muafiyet belgesi (G2 etkinleştirme kilidi) — satıcı imzalı, kurulum anahtarına ve parmak izine bağlı.
import { z } from "zod";
import { FingerprintSchema, InstallationKidSchema, IsoTimeSchema, JwsTextSchema, PROTOCOL_VERSION, UuidSchema } from "./belgeler";

/**
 * MUAFİYET (G2): etkinleştirme kilidinden önce doğmuş, hiç etkinleşmemiş kuruluma satıcının verdiği muafiyet — kurulum
 * anahtarına ve parmak izine bağlıdır (DB işareti kopyacı tarafından da yazılabilirdi). Kök ya da HAK ara imzacısı
 * imzalar; ara imzalıysa `imzaciSertifikasi` (kök imzalı `HAK` sertifikası) gömülüdür.
 */
export const ExemptionSchema = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  muafiyetId: UuidSchema,
  kurulumAnahtarKimligi: InstallationKidSchema,
  parmakIzi: FingerprintSchema,
  verilis: IsoTimeSchema,
  gerekce: z.string().min(1).max(500),
  imzaciSertifikasi: JwsTextSchema.optional(),
});
export type ExemptionDoc = z.infer<typeof ExemptionSchema>;
