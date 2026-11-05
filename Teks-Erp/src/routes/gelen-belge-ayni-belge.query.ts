// GET /api/gelen-belge/ayni-belge sorgusu — `gelen-belge.routes.ts` satır tavanında olduğu için ayrı dosya.
import { z } from "zod";
import { findSameDocument, type SameDocumentQuery } from "../services/gelen-belge-ayni-belge.service";

const Id = z.uuid("Geçersiz kimlik");
const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/, "Geçersiz sha256");
const SameDocumentQuerySchema = z.object({
  sha256: z.string().optional().transform((v) => (v ? v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : []))
    .pipe(z.array(Sha256Hex).max(20, "En çok 20 sha256")),
  sahip: Id.optional(),
  belgeNo: z.string().trim().max(64, "En çok 64 karakter").optional(),
  haric: Id.optional(),
});

export function parseSameDocumentQuery(query: unknown): SameDocumentQuery {
  const q = SameDocumentQuerySchema.parse(query);
  return { sha256: q.sha256, ownerCustomerId: q.sahip ?? null, senderDocNo: q.belgeNo ?? null, excludeNoteId: q.haric ?? null };
}

/** Uç gövdesi: sorgu doğrulanır (400) → `findSameDocument` (salt okuma). */
export const findSameDocumentByQuery = (query: unknown) => findSameDocument(parseSameDocumentQuery(query));
