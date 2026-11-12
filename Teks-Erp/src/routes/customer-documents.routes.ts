// =============================================================================
// Carinin belgeleri — Mount: /api/customers/:customerId/documents
// =============================================================================
// Salt okuma, sayfalı; tür başına okuma izni + modül kapısı servis içinde (izinsiz tür listede HİÇ yok).
// Belge içeriği mevcut uçlardan açılır (`/api/printed-documents/:docType/:sourceId/html`, gelen belge ekranı).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { readFilterList } from "../utils/query-parser";
import { CUSTOMER_DOC_TYPES, listCustomerDocuments } from "../services/customer-documents.service";
import "../types/express-augment";

const router = Router({ mergeParams: true });
// Dosya başı kapı (BE-30): yeni uç eklenince guard unutulmasın.
router.use(verifyToken, requirePermission("customer:read"));

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı.");

/** Tanınmayan anahtar ya da tür 400 (fail-closed). `type` CSV ya da tekrarlı parametre. */
export const customerDocumentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    from: dayKey.optional(),
    to: dayKey.optional(),
  })
  .strict()
  .transform((q, ctx) => {
    const types = readFilterList(q.type);
    const unknown = types.filter((t) => !(CUSTOMER_DOC_TYPES as readonly string[]).includes(t));
    if (unknown.length) ctx.addIssue({ code: "custom", path: ["type"], message: `Tanınmayan belge türü: ${unknown.join(", ")}` });
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["from"], message: "Başlangıç tarihi bitişten sonra olamaz." });
    return { page: q.page, pageSize: q.pageSize, from: q.from, to: q.to, types: types as (typeof CUSTOMER_DOC_TYPES)[number][] };
  });

/**
 * @openapi
 * /api/customers/{customerId}/documents:
 *   get:
 *     tags: [Customers]
 *     summary: Carinin belgeleri (basılı belgeler + gelen belgeler, sayfalı)
 *     description: |
 *       Kaynak kaydın carisiyle süzülen basılı belge sürümleri (SUPERSEDED hariç; VOIDED durumuyla) ve cariye bağlı
 *       gelen belgeler. Kimlik ↔ rol: kartın fason profili ve cari hesapları aynı kimliktir. Her tür kendi okuma
 *       izni ve modülüyle görünür; `types` görünen türleri söyler. İstenen tür görünmüyorsa kesişimden düşer.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: customerId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 25, maximum: 100 } }
 *       - { in: query, name: type, schema: { type: string }, description: "Tür listesi (CSV)" }
 *       - { in: query, name: from, schema: { type: string, format: date }, description: "Fabrika günü (dahil)" }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: "Fabrika günü (dahil)" }
 *     responses:
 *       200: { description: "{ data: [{ kind, docType, id, sourceId, documentNo, date, status, version, target }], pagination, types }" }
 *       400: { description: Tanınmayan parametre ya da tür }
 *       404: { description: Cari yok }
 */
router.get("/", async (req, res, next) => {
  try {
    const customerId = assertValidUuid((req.params as Record<string, string>).customerId, "customerId");
    const q = customerDocumentsQuerySchema.parse(req.query);
    const result = await listCustomerDocuments(customerId, q, req.user?.permissions ?? []);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

export default router;
