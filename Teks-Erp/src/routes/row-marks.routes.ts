// =============================================================================
// SATIR İŞARETİ + NOT — controller'sız ince uçlar (doğrulama + servise delege).
// Yeni izin kodu YOK: tür kapısı `constants/row-mark-entities.ts` (türün okuma izni) serviste.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { RowMarkColor } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { ROW_MARK_ENTITY_PERMISSIONS, ROW_MARK_LOOKUP_MAX, ROW_MARK_NOTE_MAX } from "../constants/row-mark-entities";
import { listMyRowMarkIds, lookupRowMarks, putRowMark, type RowMarkViewer } from "../services/row-mark.service";
import "../types/express-augment";

const router = Router();
// Kaba kapı: en az bir işaretlenebilir türü okuyabilmeli; tür başına kesin kapı serviste (assertRowMarkAccess).
router.use(verifyToken, requireAnyPermission(...Object.values(ROW_MARK_ENTITY_PERMISSIONS)));

const viewerOf = (req: Request): RowMarkViewer => ({ userId: req.user!.userId, permissions: req.user?.permissions ?? [] });

const entityType = z.string().trim().min(1, "Kayıt türü zorunlu").max(40);
const color = z.enum(RowMarkColor, { error: "Geçersiz işaret rengi" });

const LookupBody = z.strictObject({
  entityType,
  recordIds: z.array(z.uuid("Geçersiz kayıt kimliği")).max(ROW_MARK_LOOKUP_MAX, `En çok ${ROW_MARK_LOOKUP_MAX} kayıt sorgulanabilir`),
});

const PutBody = z.strictObject({
  entityType,
  recordId: z.uuid("Geçersiz kayıt kimliği"),
  color: color.nullable(),
  note: z.string().max(ROW_MARK_NOTE_MAX, `Not en çok ${ROW_MARK_NOTE_MAX} karakter olabilir`).nullable(),
  shared: z.boolean().default(false),
});

const MineQuery = z.object({
  entityType,
  color: color.optional(),
  cursor: z.uuid("Geçersiz imleç").optional(),
  limit: z.coerce.number().int().min(1).max(ROW_MARK_LOOKUP_MAX).default(ROW_MARK_LOOKUP_MAX),
});

/**
 * @openapi
 * /api/row-marks/lookup:
 *   post:
 *     tags: [System]
 *     summary: Görünen satırların işaretleri — kendi işaretin + başkalarının paylaşılan işaretleri
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entityType, recordIds]
 *             properties:
 *               entityType: { type: string, example: order, description: "Kayıt türü (beyanlı küme)" }
 *               recordIds: { type: array, maxItems: 200, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "marks {recordId, color, note, shared, mine, ownerName, updatedAt}[] — kendi işaretin önce" }
 *       400: { description: "ROW_MARK_ENTITY_UNKNOWN · doğrulama (en çok 200 kimlik)" }
 *       403: { description: Türün okuma yetkisi yok }
 */
router.post("/lookup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = LookupBody.parse(req.body);
    res.json({ success: true, data: { marks: await lookupRowMarks(viewerOf(req), body.entityType, body.recordIds) } });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/row-marks:
 *   put:
 *     tags: [System]
 *     summary: Kendi işaretini yaz (upsert); renk ve not ikisi de boşsa işaret kaldırılır
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entityType, recordId, color, note]
 *             properties:
 *               entityType: { type: string, example: order }
 *               recordId: { type: string, format: uuid }
 *               color: { type: string, nullable: true, enum: [YELLOW, RED, GREEN, BLUE, PURPLE] }
 *               note: { type: string, nullable: true, maxLength: 500 }
 *               shared: { type: boolean, default: false, description: "Herkese açık (sahibinin adıyla görünür)" }
 *     responses:
 *       200: { description: "mark (yazılan işaret) ya da null (kaldırıldı)" }
 *       400: { description: "ROW_MARK_ENTITY_UNKNOWN · doğrulama (not ≤ 500)" }
 *       403: { description: Türün okuma yetkisi yok }
 */
router.put("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = PutBody.parse(req.body);
    res.json({ success: true, data: { mark: await putRowMark(viewerOf(req), body) } });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/row-marks/mine:
 *   get:
 *     tags: [System]
 *     summary: Kendi işaretli kayıt kimliklerin ("İşaretliler" süzgeci), cursor sayfalı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: entityType, required: true, schema: { type: string } }
 *       - { in: query, name: color, schema: { type: string, enum: [YELLOW, RED, GREEN, BLUE, PURPLE] } }
 *       - { in: query, name: cursor, schema: { type: string, format: uuid } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: "recordIds string[] · nextCursor · hasMore" }
 *       400: { description: ROW_MARK_ENTITY_UNKNOWN }
 *       403: { description: Türün okuma yetkisi yok }
 */
router.get("/mine", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = MineQuery.parse(req.query);
    res.json({ success: true, data: await listMyRowMarkIds(viewerOf(req), q.entityType, q) });
  } catch (err) {
    next(err);
  }
});

export default router;
