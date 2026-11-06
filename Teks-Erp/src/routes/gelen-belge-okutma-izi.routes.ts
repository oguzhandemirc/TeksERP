// =============================================================================
// İstasyon belge okutma İZİ uçları (doğrulama puanı, 2026-11-06) — `gelen-belge.routes.ts` içine `router.use` ile
// bağlanır: kimlik + modül kapısı + gövde katmanı üst router'dan miras. Yazdığı tek şey TELEMETRİ (`station-scan-check`).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { listStationScanChecks, markStationScanOpened } from "../services/station-scan-check.service";
import { TERIM } from "../constants/terim";

/** Okutma uçlarının izin kümesi (okutma ucu da buradan okur — tek kaynak). */
export const STATION_LOOKUP_PERMISSIONS = ["gelen-belge:read", "mobile:kk2-kursun", "mobile:tambur"] as const;

const router = Router();
const Id = z.uuid("Geçersiz kimlik");
const send = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await fn(req) });
  } catch (err) {
    next(err);
  }
};

const ScanOpenedBody = z.strictObject({
  workOrderNumber: z.string().trim().min(1, `${TERIM.terbiyeIsEmri.tekil} no boş`).max(64, "En çok 64 karakter"),
  how: z.enum(["AUTO", "CHOSEN", "CONFIRMED"], "Seçenek AUTO, CHOSEN ya da CONFIRMED olmalı"),
});
const ScanChecksQuery = z.strictObject({ take: z.coerce.number().int().min(1).max(200).optional() });
/**
 * @openapi
 * /api/gelen-belge/istasyon-okutma/{id}/acilan:
 *   post:
 *     tags: [GelenBelge]
 *     summary: "Okutma izine tabletin açtığı İE no'yu yazar (TELEMETRİ; tek sefer). how AUTO kendiliğinden · CHOSEN listeden · CONFIRMED eşik altı, görevli onayladı"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, required: [workOrderNumber, how], properties: { workOrderNumber: { type: string }, how: { type: string, enum: [AUTO, CHOSEN, CONFIRMED] } } }
 *     responses:
 *       200: { description: "id" }
 *       409: { description: "STATION_SCAN_CHECK_CLOSED (zaten bildirildi ya da kayıt yok)" }
 * /api/gelen-belge/istasyon-okutma/son:
 *   get:
 *     tags: [GelenBelge]
 *     summary: "Son okutmalar: puan · karar · açılan İE · görevli onayı (eşiği veriyle ayarlamak için; TELEMETRİ)"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: take, schema: { type: integer, minimum: 1, maximum: 200 } }
 *     responses:
 *       200: { description: "Okutma izleri (en yeni önce)" }
 */
router.get("/istasyon-okutma/son", requirePermission("gelen-belge:read"), send((req) => listStationScanChecks(ScanChecksQuery.parse(req.query).take ?? 50)));
router.post("/istasyon-okutma/:id/acilan", requireAnyPermission(...STATION_LOOKUP_PERMISSIONS), send((req) => {
  const body = ScanOpenedBody.parse(req.body);
  return markStationScanOpened(Id.parse(req.params.id as string), body.workOrderNumber, body.how);
}));

export default router;
