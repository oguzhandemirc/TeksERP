// =============================================================================
// TeksERP — Destek uçları (`/api/destek/*`, 3d-2)
// =============================================================================
// Panelden satıcıya destek talebi: konu + açıklama + isteğe bağlı ekran görüntüsü; sağlık özeti
// gönderimde otomatik. Talep satıcıya kurulum imzalı gider (giden kutusu); yanıtlar zil `destek`
// + yoklama yanıtıyla döner. Tek izin `support:create` (liste + ayrıntı + oluşturma). Tablet yok (v1).
// Lisans kapısında HER kademede açık (`ALWAYS_OPEN_ROUTES`): kilitli kurulum da satıcıya ulaşabilmeli.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { readClientVersionHeader } from "../constants/client-info";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import { CreateSupportTicketSchema, SUPPORT_LOCAL_STATES, createSupportTicket, getSupportTicket, listSupportTickets } from "../services/support.service";

const router = Router();
router.use(verifyToken, requirePermission("support:create"));

const ListQuery = z.object({
  durum: z.enum(SUPPORT_LOCAL_STATES, "Tanınmayan durum").optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * @openapi
 * /api/destek:
 *   get:
 *     tags: [Destek]
 *     summary: Destek talepleri (yerel kopya; durum satıcıdan yoklamayla gelir)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: durum, required: false, schema: { type: string, enum: [GONDERILMEDI, ACIK, YANITLANDI, KAPANDI] } }
 *       - { in: query, name: limit, required: false, schema: { type: integer, minimum: 1, maximum: 200 } }
 *     responses:
 *       200: { description: "Talepler (son hareket sırasıyla), yanıt sayısıyla" }
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = ListQuery.parse(req.query);
    res.status(200).json({ success: true, data: await listSupportTickets({ status: q.durum, limit: q.limit }) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/destek/{id}:
 *   get:
 *     tags: [Destek]
 *     summary: Destek talebi ayrıntısı + satıcı yanıtları (ekran görüntüsü baytı dönmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Talep }
 *       404: { description: Talep yok (SUPPORT_TICKET_NOT_FOUND) }
 */
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw AppError.notFound("Destek talebi bulunamadı.", { code: "SUPPORT_TICKET_NOT_FOUND" });
    res.status(200).json({ success: true, data: await getSupportTicket(id.data) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/destek:
 *   post:
 *     tags: [Destek]
 *     summary: Satıcıya destek talebi aç (clientToken ile idempotent; sağlık özeti otomatik)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, konu, aciklama]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               konu: { type: string, maxLength: 200 }
 *               aciklama: { type: string, maxLength: 5000 }
 *               ekranGoruntusu: { type: object, nullable: true, properties: { tur: { type: string, enum: [image/png, image/jpeg] }, veri: { type: string, description: base64 } } }
 *     responses:
 *       201: { description: "Talep (durum GONDERILMEDI ise gönderim yoklama sonrası yeniden denenir)" }
 *       400: { description: Geçersiz gövde ya da ekran görüntüsü }
 *       409: { description: İşlem kimliği başka talebe ait (CLIENT_TOKEN_COLLISION) }
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = CreateSupportTicketSchema.parse(req.body ?? {});
    const userId = req.user?.userId;
    if (!userId) throw AppError.unauthorized("Oturum gerekli.");
    const data = await createSupportTicket({ userId, input, panelVersion: readClientVersionHeader(req.headers) });
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
