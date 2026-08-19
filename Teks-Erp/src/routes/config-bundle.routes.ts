import { Router, type NextFunction, type Request, type Response } from "express";
import express from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import {
  applyBundle,
  exportBundle,
  planBundle,
  validateEnvelope,
  kindsInBundle,
  BUNDLE_KINDS,
  BUNDLE_LABELS,
  BUNDLE_PERMISSIONS,
  type BundleKind,
} from "../services/import/config-bundle.service";

// =============================================================================
// YAPILANDIRMA PAKETİ UÇLARI (kurulumlar arası tanım taşıma)
// =============================================================================
// ⚠️ YETKİ ANAHTAR-KAPSAMLIDIR — `PATCH /api/feature-flags` guard'ının birebir
// dersi: pakette hangi tür varsa YALNIZ onun izni aranır. Düz bir OR, "etiket
// şablonu taşıyorum" diyen birine rol şablonu yazdırırdı. FAIL-CLOSED.

const router = Router();
const jsonBig = express.json({ limit: "10mb" });

const conflictSchema = z.enum(["rename", "overwrite", "skip"]).default("rename");
const bodySchema = z.object({
  envelope: z.unknown(),
  onConflict: conflictSchema,
});

/** İstenen türlerin HEPSİ için ilgili izin aranır (read ya da write). */
function assertKindPermissions(
  req: Request,
  kinds: BundleKind[],
  mode: "read" | "write",
): void {
  if (!req.user) throw AppError.unauthorized("Kimlik doğrulama gerekli.");
  const missing = kinds.filter((k) => !matchesPermission(req.user!.permissions, BUNDLE_PERMISSIONS[k][mode]));
  if (missing.length > 0) {
    throw AppError.forbidden(
      `Bu paket için eksik yetki: ${missing
        .map((k) => `${BUNDLE_LABELS[k]} (${BUNDLE_PERMISSIONS[k][mode]})`)
        .join(" · ")}`,
    );
  }
}

function parseKinds(raw: unknown): BundleKind[] {
  if (typeof raw !== "string" || !raw.trim()) return [...BUNDLE_KINDS];
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = wanted.filter((k) => !(BUNDLE_KINDS as readonly string[]).includes(k));
  if (bad.length > 0) throw AppError.badRequest(`Bilinmeyen tür: ${bad.join(", ")}`);
  return wanted as BundleKind[];
}

/**
 * @openapi
 * /api/config-bundle/kinds:
 *   get:
 *     tags: [ConfigBundle]
 *     summary: Taşınabilir yapılandırma türleri (kullanıcının yetkisiyle işaretli)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/kinds", verifyToken, (req: Request, res: Response) => {
  const perms = req.user?.permissions ?? [];
  res.json({
    success: true,
    data: BUNDLE_KINDS.map((k) => ({
      kind: k,
      label: BUNDLE_LABELS[k],
      canRead: matchesPermission(perms, BUNDLE_PERMISSIONS[k].read),
      canWrite: matchesPermission(perms, BUNDLE_PERMISSIONS[k].write),
    })),
  });
});

/**
 * @openapi
 * /api/config-bundle/export:
 *   get:
 *     tags: [ConfigBundle]
 *     summary: Yapılandırma paketi (JSON zarf) — kurulumlar arası taşıma
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: kinds
 *         schema: { type: string }
 *         description: Virgülle ayrılmış tür listesi; boş = izinli tüm türler
 */
router.get("/export", verifyToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kinds = parseKinds(req.query.kinds);
    assertKindPermissions(req, kinds, "read");
    res.json({ success: true, data: await exportBundle(kinds) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/config-bundle/preview:
 *   post:
 *     tags: [ConfigBundle]
 *     summary: Paketin hedefte ne yapacağını gösterir — HİÇBİR ŞEY yazmaz
 *     security: [{ bearerAuth: [] }]
 */
router.post("/preview", verifyToken, jsonBig, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodySchema.parse(req.body);
    const envelope = validateEnvelope(body.envelope);
    assertKindPermissions(req, kindsInBundle(envelope), "write");
    res.json({ success: true, data: await planBundle(envelope, body.onConflict) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/config-bundle/apply:
 *   post:
 *     tags: [ConfigBundle]
 *     summary: Paketi uygular (planı SIFIRDAN yeniden hesaplar)
 *     security: [{ bearerAuth: [] }]
 */
router.post("/apply", verifyToken, jsonBig, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodySchema.parse(req.body);
    const envelope = validateEnvelope(body.envelope);
    assertKindPermissions(req, kindsInBundle(envelope), "write");
    res.json({ success: true, data: await applyBundle(envelope, body.onConflict, req.user?.userId) });
  } catch (e) {
    next(e);
  }
});

export default router;
