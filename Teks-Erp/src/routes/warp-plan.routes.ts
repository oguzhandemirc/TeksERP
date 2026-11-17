// Çözgü hesabı (fason devere D1): levent adedi × boy → iplik kg; eldeki iplik → en çok metre. Salt okuma.
// Kapılar: verifyToken → devere modülü → warpspec:read. İplik modülü kapalıysa stok `null` döner (kapı değil).
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled } from "../middlewares/module.middleware";
import { calculateWarpPlan, WARP_PLAN_MAX_LINES } from "../services/warp-plan.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDevereEnabled);

const lineSchema = z.strictObject({
  yarnItemId: z.uuid({ message: "İplik kimliği geçersiz" }),
  endsCount: z.number({ message: "Tel adedi sayı olmalı" }).int("Tel adedi tam sayı olmalı").positive("Tel adedi sıfırdan büyük olmalı").max(1_000_000, "Tel adedi çok büyük"),
});

const calcSchema = z.strictObject({
  mode: z.enum(["FROM_BEAMS", "FROM_STOCK"], { message: "Hesap yönü FROM_BEAMS ya da FROM_STOCK olmalı" }),
  warpSpecId: z.uuid({ message: "Çözgü kartı kimliği geçersiz" }).optional(),
  lines: z.array(lineSchema).min(1, "En az bir iplik satırı gerekli").max(WARP_PLAN_MAX_LINES, `En çok ${WARP_PLAN_MAX_LINES} iplik satırı`).optional(),
  specWastePct: z.number({ message: "Kart firesi sayı olmalı" }).min(0, "Kart firesi negatif olamaz").lt(100, "Kart firesi 100'den küçük olmalı").nullable().optional(),
  beamCount: z.number({ message: "Levent adedi sayı olmalı" }).int("Levent adedi tam sayı olmalı").positive("Levent adedi sıfırdan büyük olmalı").max(10_000, "Levent adedi çok büyük").optional(),
  beamLengthM: z.number({ message: "Levent boyu sayı olmalı" }).positive("Levent boyu sıfırdan büyük olmalı").max(1_000_000, "Levent boyu çok büyük").optional(),
  fixedWasteM: z.number({ message: "Sabit fire sayı olmalı" }).min(0, "Sabit fire negatif olamaz").max(1000, "Sabit fire en çok 1000 m").optional(),
  subcontractorId: z.uuid({ message: "Devereci kimliği geçersiz" }).optional(),
});

/**
 * @openapi
 * /api/warp-plan/calculate:
 *   post:
 *     tags: [WarpSpecs]
 *     summary: Çözgü hesabı — iki yön (yazmaz)
 *     description: |
 *       FROM_BEAMS: levent adedi × boy → iplik başına formül (firesiz) kg, fireli öneri, deverecide, gönderilecek, depo eksiği.
 *       FROM_STOCK: depo + deverecide iplikten en çok metre, kısıtlayan iplik, artan kg, tam levent adedi.
 *       Girdi kayıtlı çözgü kartı (`warpSpecId`) ya da gövdedeki satırlar (`lines`). Kg = tel × denye × metre ÷ 9.000.000.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hesap sonucu }
 *       400: { description: Geçersiz girdi }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: Çözgü kartı yok }
 */
router.post("/calculate", requirePermission("warpspec:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await calculateWarpPlan(calcSchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

export default router;
