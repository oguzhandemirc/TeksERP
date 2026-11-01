// =============================================================================
// Müşteri barkod serisi (`/api/customers/:id/barcode-series`, D4-F2 — DALGA4 §7.4, §7.7)
// =============================================================================
// Okuma `customer:read`, yazma `customer:write` (tasarım §7.7; yeni izin yok); müşteri kodu emanet kavramı →
// bağla uçlarıyla aynı modül kapısı (`requireEmanetEnabled`). Gövde parse'ı ve kapılar serviste.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireEmanetEnabled } from "../middlewares/module.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { CustomerBarcodeSeriesService } from "../services/customer-barcode-series.service";

// Mount: /api/customers/:id/barcode-series (mergeParams — `:id` üst yoldan).
const router = Router({ mergeParams: true });
router.use(verifyToken, requireEmanetEnabled);

type Handler = (req: Request) => Promise<{ status: number; body: unknown }>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
};
const id = (req: Request) => req.params.id as string;

/**
 * @openapi
 * /api/customers/{id}/barcode-series:
 *   get:
 *     tags: [Customers]
 *     summary: Müşterinin barkod serisi + sıradaki kod (sayacı tüketmez)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ series | null, nextCode | null }" }
 *   post:
 *     tags: [Customers]
 *     summary: Barkod serisi tanımla (clientToken zorunlu; aynı token → aynı seri; ikinci seri 409 CUSTOMER_SERIES_EXISTS)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Seri }
 *       409: { description: CUSTOMER_SERIES_EXISTS · CUSTOMER_CODE_COLLIDES · CLIENT_TOKEN_COLLISION }
 *   put:
 *     tags: [Customers]
 *     summary: Biçim/etkinlik değiştir (expectedFormatChangedAt atomik; eski kodlar değişmez, sayaç yeni biçimden)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Seri }
 *       409: { description: SERIES_CHANGED · CUSTOMER_CODE_COLLIDES }
 * /api/customers/{id}/barcode-series/preview:
 *   post:
 *     tags: [Customers]
 *     summary: Biçim önizlemesi (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ codes, formatChanged, collides }" }
 */
router.get(
  "/",
  requirePermission("customer:read"),
  wrap(async (req) => ({ status: 200, body: await CustomerBarcodeSeriesService.get(id(req)) })),
);
router.post(
  "/",
  requirePermission("customer:write"),
  wrap(async (req) => {
    const r = await CustomerBarcodeSeriesService.create(id(req), req.body, req.user?.userId);
    return { status: r.idempotent ? 200 : 201, body: r };
  }),
);
router.put(
  "/",
  requirePermission("customer:write"),
  wrap(async (req) => ({ status: 200, body: await CustomerBarcodeSeriesService.update(id(req), req.body, req.user?.userId) })),
);
router.post(
  "/preview",
  requirePermission("customer:write"),
  wrap(async (req) => ({ status: 200, body: await CustomerBarcodeSeriesService.preview(id(req), req.body) })),
);

export default router;
