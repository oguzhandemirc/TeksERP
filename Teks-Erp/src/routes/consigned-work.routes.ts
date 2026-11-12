// =============================================================================
// TeksERP — İÇERİDEKİ İŞLER (emanet; ister 3.2) + EMANET EKSTRESİ (genel fason F2) — salt okuma
// =============================================================================
// Kapı sırası: `verifyToken` → `requireEmanetEnabled` → `roll:read` (yeni izin YOK; envanterin okuma izni).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireEmanetEnabled } from "../middlewares/module.middleware";
import { getConsignedWorkSummary } from "../services/roll-owner.service";
import { listSearchParam } from "../utils/list-search";
import { getConsignedStatement } from "../services/consigned-statement.service";

const router = Router();
router.use(verifyToken, requireEmanetEnabled);
router.use(requirePermission("roll:read"));

/**
 * @openapi
 * /api/consigned-work:
 *   get:
 *     tags: [Inventory]
 *     summary: İçerideki İşler — müşteri başına içerideki emanet top/metre, durum kırılımıyla (ister 3.2)
 *     description: |
 *       Ölü (K18) · sevk edilmiş · fire · fason dönüşünde kapanmış toplar DIŞLANIR. Kovalar Envanter sekme kapsamlarının
 *       aynası: waiting (adımsız STOCK) · inProcess (iş emri adımında) · ready (WAREHOUSE/A1_STOCK) · other. Metre = `currentQty`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: onlyReady
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Yalnız sevke hazır (WAREHOUSE/A1_STOCK) emaneti olan sahipler; toplamlar aynı kapsamdan
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *         description: "Metin araması — sahip (müşteri) adı ya da kodu; toplamlar süzülen satırlardan; boş = arama yok"
 *     responses:
 *       200: { description: Sahip satırları + toplam }
 *       400: { description: Tanınmayan süzgeç ya da 100 karakteri aşan arama (CONSIGNED_WORK_FILTER_INVALID) }
 *       403: { description: Emanet modülü kapalı (MODULE_DISABLED) ya da roll:read yok }
 */
/** Fail-closed: tanınmayan parametre/değer 400 (eski istemci parametre göndermez → bugünkü liste). */
const consignedWorkQuery = z.object({ onlyReady: z.enum(["true", "false"]).optional(), search: listSearchParam }).strict();

router.get("/", async (req, res, next) => {
  try {
    const parsed = consignedWorkQuery.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Geçersiz süzgeç: yalnız onlyReady=true|false ve search (≤100 karakter) kabul edilir.", { code: "CONSIGNED_WORK_FILTER_INVALID" });
    }
    res.json(await getConsignedWorkSummary({ onlyReady: parsed.data.onlyReady === "true", search: parsed.data.search }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/consigned-work/{customerId}/statement:
 *   get:
 *     tags: [Inventory]
 *     summary: Emanet ekstresi — müşteri malının dönem mutabakatı (açılış · giren · çıkan BRÜT · DSK · fire · kalan)
 *     description: |
 *       Defterden as-of türetilir (geçmiş dönem yeni kayıtla değişmez; storno ayrı satır). Bölümler: top (m) · iplik
 *       lotu (kg; iplik modülü + warehouse:read) · levent (m; devere + warpbeam:read) — yetkisiz/kapalı bölüm null + `omitted`.
 *       Dönem fabrika günüdür. Değişmez: opening + Σ lines.effect = closing; Σ subjects = totals.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         required: true
 *         schema: { type: string, example: "2026-11-01" }
 *       - in: query
 *         name: to
 *         required: true
 *         schema: { type: string, example: "2026-11-30" }
 *     responses:
 *       200: { description: Ekstre (customer · period · rolls · yarnLots · warpBeams · omitted · reconciliation) }
 *       400: { description: Tanınmayan/bozuk parametre ya da çok uzun dönem (CONSIGNED_STATEMENT_PARAM_INVALID · CONSIGNED_STATEMENT_TOO_LARGE) }
 *       403: { description: Emanet modülü kapalı (MODULE_DISABLED) ya da roll:read yok }
 *       404: { description: Müşteri yok (CUSTOMER_NOT_FOUND) }
 */
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Fail-closed: iki uç zorunlu, tanınmayan parametre 400 (sessiz varsayılan dönem kurulmaz). */
const statementQuerySchema = z.object({ from: YMD, to: YMD }).strict();
const statementParamsSchema = z.object({ customerId: z.string().uuid() });

router.get("/:customerId/statement", async (req, res, next) => {
  try {
    const params = statementParamsSchema.safeParse(req.params);
    const query = statementQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      throw AppError.badRequest("Geçersiz ekstre isteği: müşteri kimliği UUID, from/to YYYY-MM-DD olmalı; başka parametre kabul edilmez.", {
        code: "CONSIGNED_STATEMENT_PARAM_INVALID",
      });
    }
    const perms = req.user!.permissions;
    const r = await getConsignedStatement({
      customerId: params.data.customerId,
      from: query.data.from,
      to: query.data.to,
      access: { yarn: matchesPermission(perms, "warehouse:read"), beam: matchesPermission(perms, "warpbeam:read") },
    });
    res.json(r);
  } catch (e) {
    next(e);
  }
});

export default router;
