// SATICI PORTALI — ham gövdeli/akışlı dağıtım uçları (/portal/api/ham; tailnet ve ERİŞİM). JSON rota tablosuna
// sığmaz (gövde ham bayt ya da yanıt dosya akışı) ama AYNI oturum + izin kapısından geçer
// (`requirePortalSession`). CSRF: SameSite=Strict çerez + parça PUT'u özel başlık ister (form gönderemez).
// ERİŞİM'de yalnız erisim-rotalari.ts `ERISIM_HAM_ROTALARI` bağlanır (opt-in); işleyiciler istek kapsamında koşar.
//   PUT /giden-oturum/:id/parca/:sira   (X-Parca-Sha256)      GET /dosyalar/:id   (gövdeyi indir)
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { writePart } from "../distribution/sessions.service";
import { bodyPath } from "../distribution/storage";
import { VendorError, notFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { openVerified, streamFile } from "./distribution-public";
import type { PortalListener } from "../portal/roles";
import { ERISIM_HAM_ROTALARI } from "./erisim-rotalari";
import { allowlistGate, requirePortalSession, scopedHandler } from "./portal-http";

/** Ham rotaların anahtarları ("YÖNTEM /yol") — ERİŞİM listesi bunların dışında satır taşıyamaz. */
export const RAW_ROUTE_KEYS: readonly string[] = ["PUT /giden-oturum/:id/parca/:sira", "GET /dosyalar/:id"];

function uuidOf(req: Request, name: string, what: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !z.uuid().safeParse(v).success) throw notFoundError(what);
  return v;
}

export function createDistributionRawRouter(ctx: VendorContext, listener: PortalListener): Router {
  const router = express.Router();
  const allowed = listener === "ERISIM" ? ERISIM_HAM_ROTALARI : null;
  if (allowed) {
    const stale = [...allowed].filter((k) => !RAW_ROUTE_KEYS.includes(k));
    if (stale.length > 0) throw new Error(`ERİŞİM ham izin listesi geçersiz: ${stale.join(", ")} ham yönlendiricide yok`);
    router.use(allowlistGate(allowed));
  }
  const bind = (key: string): boolean => allowed === null || allowed.has(key);
  router.use((_req: Request, res: Response, next: () => void) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    next();
  });

  if (bind("PUT /giden-oturum/:id/parca/:sira")) {
    router.put(
      "/giden-oturum/:id/parca/:sira",
      scopedHandler(listener, "PUT /giden-oturum/:id/parca/:sira", (req, res) => putPart(ctx, listener, req, res), {
        ayakIziMuaf: "parça yazımı: ayak izini oturumu açan ve tamamlayan JSON yazması taşır; parça başına satır denetimi boğar",
      }),
    );
  }
  if (bind("GET /dosyalar/:id")) {
    router.get(
      "/dosyalar/:id",
      scopedHandler(listener, "GET /dosyalar/:id", (req, res) => downloadFile(ctx, listener, req, res)),
    );
  }
  return router;
}

async function putPart(ctx: VendorContext, listener: PortalListener, req: Request, res: Response): Promise<void> {
  const session = await requirePortalSession(ctx, listener, { req, res }, "dagitim:yaz");
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
}

async function downloadFile(ctx: VendorContext, listener: PortalListener, req: Request, res: Response): Promise<void> {
  await requirePortalSession(ctx, listener, { req, res }, "portal:oku");
  const f = await prisma.dagitimDosyasi.findUnique({ where: { id: uuidOf(req, "id", "Dosya") } });
  if (!f) throw notFoundError("Dosya");
  if (f.govdeBudandiAt) throw new VendorError(410, "GOVDE_BUDANDI", "Dosyanın saklama süresi dolmuş; gövde budandı");
  const target = { path: bodyPath(ctx.config.DOSYA_DIZINI, f.depoAnahtari), name: f.ad, mime: f.mime, bytes: Number(f.boyut), sha256: f.sha256 };
  const fh = await openVerified(target as Parameters<typeof openVerified>[0]);
  await streamFile(res, fh, target);
}
