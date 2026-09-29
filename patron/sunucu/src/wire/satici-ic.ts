// SATICI İÇ API tel şeması (bulut ↔ satıcı; fabrika tarafında aynası YOKTUR — fabrika bu kanalı görmez).
// Sözleşme docs/design/PATRON-BULUTU-ESITLEME.md §17; satıcı tarafı ayrı dilim.
import { z } from "zod";

const Iso = z.iso.datetime();
const Uuid = z.uuid();

/** `GET <SATICI_IC_API_URL>/ic/v1/kurulum/:kurulumId` yanıtı (sözleşme §17 — satıcı tarafı ayrı dilim). */
export const VendorInstallationSchema = z.object({
  v: z.literal(1),
  kurulumId: Uuid,
  tesis: z.object({ id: Uuid, ad: z.string().min(1).max(200) }),
  acikAnahtar: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable(),
  sinif: z.enum(["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"]),
  moduller: z.array(z.string().max(64)).max(64),
  patronBulutBitis: Iso.nullable(),
  devredildi: z.boolean(),
  aktif: z.boolean(),
  saklamaAy: z.union([z.literal(3), z.literal(13), z.literal(25), z.null()]).optional(),
});
export type VendorInstallation = z.infer<typeof VendorInstallationSchema>;
