// =============================================================================
// TeksERP - Free Document Routes (serbest belge)
// =============================================================================
// Okuma: label:read benzeri geniş (belge listeleme). Yazma/baskı: admin:settings.
// Controller'sız ince route (bilinçli istisna) — Zod parse + servise delege.

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { freeDocumentService } from "../services/free-document.service";
import "../types/express-augment";

const router = Router();

const upsertSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  recipient: z.string().max(200).nullable().optional(),
  body: z.string().max(20000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

router.get("/", verifyToken, requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await freeDocumentService.list(req.query.withInactive === "true"));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", verifyToken, requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await freeDocumentService.get(assertValidUuid(req.params.id)));
  } catch (err) {
    next(err);
  }
});

/** Baskı-hazır HTML (text/html). ?printNote= tek seferlik not. */
router.get("/:id/html", verifyToken, requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printNote = typeof req.query.printNote === "string" ? req.query.printNote.slice(0, 300) : null;
    const result = await freeDocumentService.renderHtml(assertValidUuid(req.params.id), {
      printedBy: req.user?.username ?? null,
      printNote,
    });
    res.type("html").send(result.data.html);
  } catch (err) {
    next(err);
  }
});

router.post("/", verifyToken, requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await freeDocumentService.create(upsertSchema.parse(req.body), req.user?.userId));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", verifyToken, requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await freeDocumentService.update(assertValidUuid(req.params.id), upsertSchema.parse(req.body), req.user?.userId));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", verifyToken, requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await freeDocumentService.deactivate(assertValidUuid(req.params.id), req.user?.userId));
  } catch (err) {
    next(err);
  }
});

export default router;
