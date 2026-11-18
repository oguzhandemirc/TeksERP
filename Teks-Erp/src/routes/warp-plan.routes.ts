// Çözgü hesabı (fason devere D1): levent adedi × boy → iplik kg; eldeki iplik → en çok metre. Salt okuma.
// Kapılar: verifyToken → devere modülü → warpspec:read. İplik modülü kapalıysa stok `null` döner (kapı değil).
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled } from "../middlewares/module.middleware";
import { calculateWarpPlan, suggestWarpEnds, WARP_PLAN_MAX_LINES } from "../services/warp-plan.service";
import { computeWarpNeed } from "../services/warp-need.service";
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

const positive = (label: string, max: number) =>
  z.number({ message: `${label} sayı olmalı` }).positive(`${label} sıfırdan büyük olmalı`).max(max, `${label} çok büyük`);
const suggestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("KG_PER_1000M"), yarnItemId: z.uuid({ message: "İplik kimliği geçersiz" }), kgPer1000m: positive("1000 m kg", 100_000) }),
  z.strictObject({
    kind: z.literal("REED"),
    reedPerCm: positive("Tarak", 1000),
    widthCm: positive("Tarak eni", 10_000),
    endsPerDent: z.number({ message: "Dişe tel sayı olmalı" }).int("Dişe tel tam sayı olmalı").positive("Dişe tel sıfırdan büyük olmalı").max(100, "Dişe tel çok büyük").optional(),
  }),
], { message: "Öneri türü KG_PER_1000M ya da REED olmalı" });

/**
 * @openapi
 * /api/warp-plan/ends-suggest:
 *   post:
 *     tags: [WarpSpecs]
 *     summary: Çözgü kartı tel önerisi (yazmaz)
 *     description: |
 *       KG_PER_1000M: "1000 m'ye şu kadar kg" → tel = round(kg × 9000 ÷ denye), yuvarlama farkıyla.
 *       REED: tarak (cm'deki diş) × tarak eni × dişe tel → toplam tel. Sonuç yalnız öneridir; kartı değiştirmez.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Önerilen tel }
 *       400: { description: Geçersiz girdi · iplik yok/denyesiz }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.post("/ends-suggest", requirePermission("warpspec:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await suggestWarpEnds(suggestSchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

const uuid = (label: string) => z.uuid({ message: `${label} kimliği geçersiz` });
const needSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("FABRIC"),
    itemId: uuid("Kumaş"),
    recipeId: uuid("Varyant").optional(),
    fabricM: z.coerce.number({ message: "Kumaş metresi sayı olmalı" }).positive("Kumaş metresi sıfırdan büyük olmalı").max(10_000_000, "Kumaş metresi çok büyük"),
  }),
  z.strictObject({ source: z.literal("WEAVING_ORDER"), weavingOrderId: uuid("Dokuma iş emri") }),
  z.strictObject({ source: z.literal("ORDER"), orderId: uuid("Sipariş") }),
], { message: "Kaynak FABRIC, WEAVING_ORDER ya da ORDER olmalı" });

/**
 * @openapi
 * /api/warp-plan/need:
 *   get:
 *     tags: [WarpSpecs]
 *     summary: Çözgü ihtiyacı → fason devere siparişi önerisi (yazmaz)
 *     description: |
 *       Talep (FABRIC: kumaş + ham metre · WEAVING_ORDER: dokuma işinin kalanı · ORDER: siparişin dokunacak açık satırları)
 *       → çözgü kartı başına gerekli metre (take-up) − arz (stok levent + planlanan levent + açık devere siparişi kalanı;
 *       öncelikli açık dokuma işlerine ayrılan düşülür) = eksik ve levent adedi × boy önerisi.
 *     parameters:
 *       - { in: query, name: source, required: true, schema: { type: string, enum: [FABRIC, WEAVING_ORDER, ORDER] } }
 *       - { in: query, name: itemId, schema: { type: string, format: uuid } }
 *       - { in: query, name: recipeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: fabricM, schema: { type: number } }
 *       - { in: query, name: weavingOrderId, schema: { type: string, format: uuid } }
 *       - { in: query, name: orderId, schema: { type: string, format: uuid } }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Öneri satırları + uyarılar }
 *       400: { description: Tanınmayan kaynak / eksik ya da fazla parametre }
 *       403: { description: Devere (ya da dokuma kaynağında dokuma) modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *       404: { description: Kaynak kayıt yok }
 *       409: { description: Sipariş üretime uygun değil (ORDER_NOT_PRODUCIBLE) }
 */
router.get("/need", requirePermission("warpspec:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await computeWarpNeed(needSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});

export default router;
