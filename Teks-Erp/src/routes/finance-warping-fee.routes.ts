// =============================================================================
// DEVERECİ FATURASI — `/api/finance/invoices/warping-*` + `/api/finance/invoices/:id/warping-fee-match` (devere A1)
// =============================================================================
// ⚠️ KENDİ BAŞINA MOUNT EDİLMEZ: `finance.routes.ts` onu `/invoices/:id` desenlerinden ÖNCE bağlar; `verifyToken` +
// `requireFinanceEnabled` kapısını miras alır. Devere verisine dokunan aday/taslak uçları ayrıca `requireDevereEnabled`.
// Fark yalnız UYARIR; onay kapısı yok (K4).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { createWarpingInvoiceDraft, listWarpingInvoiceCandidates, warpingFeeMatch } from "../services/warping-order/fee-invoice";

const router = Router();

/**
 * @openapi
 * /api/finance/invoices/warping-orders/candidates:
 *   get:
 *     tags: [Finance]
 *     summary: Devereci faturasına bağlanabilecek devere siparişleri ve kabulleri (devere A1)
 *     description: >
 *       Carinin deverecisine ait, kabul edilen sarımı olan siparişler; kabul başına ölçü, beklenen ücret, bağlı fatura ve
 *       `selectable` (faturasız ya da `invoiceId` ile düzenlenen faturanın kendisi). Sipariş `invoiceState` NONE/PARTIAL/FULL.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: cariId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: invoiceId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ data: WarpingFeeOrderDto[] }" }
 *       403: { description: Ön muhasebe ya da devere kapalı (MODULE_DISABLED) }
 *       404: { description: CARI_NOT_FOUND }
 */
router.get("/invoices/warping-orders/candidates", requirePermission("finance:read"), requireDevereEnabled, async (req, res, next) => {
  try {
    const q = z.strictObject({ cariId: z.string().uuid("Geçersiz cari"), invoiceId: z.string().uuid("Geçersiz fatura").optional() }).parse(req.query);
    res.json({ success: true, data: await listWarpingInvoiceCandidates(q) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/invoices/draft-from-warping:
 *   post:
 *     tags: [Finance]
 *     summary: Devere siparişlerinden / kabullerinden ALIŞ faturası taslağı (devere A1)
 *     description: >
 *       `warpingOrderIds` (faturasız bütün kabuller) YA DA `receiptKeys`. Sipariş başına tek satır: miktar = kabul edilen
 *       sarımların ücret ölçüsü, fiyat = siparişin donuk ücreti. Aynı devereci + aynı ücret dövizi zorunlu. Replay `clientToken`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taslak oluşturuldu (ya da replay) }
 *       400: { description: "WARPING_DRAFT_SCOPE_INVALID · WARPING_RECEIPT_PARTY_MISMATCH · WARPING_FEE_CURRENCY_MIXED · WARPING_RECEIPT_NOT_LINKABLE" }
 *       409: { description: "WARPING_NOTHING_TO_INVOICE · WARPING_RECEIPT_ALREADY_INVOICED · SUBCONTRACTOR_NOT_LINKED_TO_CARD · CLIENT_TOKEN_COLLISION" }
 */
router.post("/invoices/draft-from-warping", requirePermission("finance:write"), requireDevereEnabled, async (req, res, next) => {
  try {
    const b = z.strictObject({
      warpingOrderIds: z.array(z.string().uuid("Geçersiz sipariş")).min(1).max(100).optional(),
      receiptKeys: z.array(z.string().uuid("Kabul anahtarı geçersiz")).min(1).max(200).optional(),
      clientToken: z.string().uuid("İstek anahtarı geçersiz"),
    }).parse(req.body);
    res.status(201).json(await createWarpingInvoiceDraft(b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/finance/invoices/{id}/warping-fee-match:
 *   get:
 *     tags: [Finance]
 *     summary: Faturanın bağlı devere kabulleri ↔ beklenen devere ücreti (bilgi, devere A1)
 *     description: >
 *       Beklenen ↔ KDV hariç net; farklı dövizde kur çevrilmez (fark null); fiyatsız siparişte beklenen null. Bağsız faturada `data: null`.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ data: WarpingFeeMatchDto | null }" }
 *       404: { description: Fatura bulunamadı }
 */
router.get("/invoices/:id/warping-fee-match", requirePermission("finance:read"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    assertValidUuid(id, "Fatura");
    const data = await warpingFeeMatch(id);
    res.json({ success: true, data, ...(data && data.warnings.length > 0 ? { warnings: data.warnings } : {}) });
  } catch (e) {
    next(e);
  }
});

export default router;
