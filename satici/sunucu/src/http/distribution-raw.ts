// SATICI PORTALI — ham gövdeli/akışlı dağıtım uçları (/portal/api/ham, tailnet). JSON rota tablosuna
// sığmaz (gövde ham bayt ya da yanıt dosya akışı) ama AYNI oturum + izin kapısından geçer
// (`requirePortalSession`). CSRF: SameSite=Strict çerez + parça PUT'u özel başlık ister (form gönderemez).
//   PUT /giden-oturum/:id/parca/:sira   (X-Parca-Sha256)      GET /dosyalar/:id   (gövdeyi indir)
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { writePart } from "../distribution/sessions.service";
import { bodyPath } from "../distribution/storage";
import { VendorError, notFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { openVerified, streamFile } from "./distribution-public";
import { requirePortalSession } from "./portal-http";

function uuidOf(req: Request, name: string, what: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !z.uuid().safeParse(v).success) throw notFoundError(what);
  return v;
}

export function createDistributionRawRouter(ctx: VendorContext): Router {
  const router = express.Router();
  router.use((_req: Request, res: Response, next: () => void) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    next();
  });

  router.put("/giden-oturum/:id/parca/:sira", async (req: Request, res: Response) => {
    const session = await requirePortalSession(ctx, "TAILNET", { req, res }, "dagitim:yaz");
    const id = uuidOf(req, "id", "Yükleme oturumu");
    const s = await prisma.yuklemeOturumu.findUnique({ where: { id }, select: { musteriId: true } });
    if (!s) throw notFoundError("Yükleme oturumu");
    const sira = String(req.params.sira ?? "");
    const data = await writePart(ctx.config, {
      owner: { kind: "SATICI", customerId: s.musteriId, actor: session.actor },
      sessionId: id,
      index: /^\d{1,6}$/.test(sira) ? Number(sira) : -1,
      sha256: String(req.get("x-parca-sha256") ?? ""),
      body: req,
      nowMs: Date.now(),
    });
    res.json({ success: true, data });
  });

  router.get("/dosyalar/:id", async (req: Request, res: Response) => {
    await requirePortalSession(ctx, "TAILNET", { req, res }, "portal:oku");
    const f = await prisma.dagitimDosyasi.findUnique({ where: { id: uuidOf(req, "id", "Dosya") } });
    if (!f) throw notFoundError("Dosya");
    if (f.govdeBudandiAt) throw new VendorError(410, "GOVDE_BUDANDI", "Dosyanın saklama süresi dolmuş; gövde budandı");
    const target = { path: bodyPath(ctx.config.DOSYA_DIZINI, f.depoAnahtari), name: f.ad, mime: f.mime, bytes: Number(f.boyut), sha256: f.sha256 };
    const fh = await openVerified(target as Parameters<typeof openVerified>[0]);
    await streamFile(res, fh, target);
  });
  return router;
}
