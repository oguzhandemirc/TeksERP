// GENEL DİNLEYİCİ (Traefik/Cloudflare arkası): /v1/* protokol uçları + /q QR sayfası + /d · /y · /yayin (dağıtım) + /bayi/api
// (yalnız BAYI rolünün alt-portalı) + bayi web arayüzü (/bayi, satici/web dist/bayi). Satıcı portalı,
// satıcı arayüzü ve kök parolası isteyen hiçbir uç burada YOK.
// Sıkıştırma ara katmanı bilerek yok: zil (SSE) akışı `no-transform` ile tamponsuz gitmeli.
import express, { type Express, type Request, type Response } from "express";
import {
  ActivateRequestSchema,
  DrTakeoverRequestSchema,
  ENDPOINTS,
  OfflineRequestSchema,
  PollRequestSchema,
  REQUEST_HEADER,
  SupportRequestSchema,
  TransferRequestSchema,
  isPlainObject,
  openEnvelope,
} from "../lisans-protokol";
import { VendorError } from "../lib/errors";
import { handleActivation } from "../services/activation.service";
import { acceptsClosingLease } from "../services/closing-lease";
import type { VendorContext } from "../services/context";
import type { DoorbellHub } from "../services/doorbell";
import { drTakeoverTarget, processDrTakeover } from "../services/dr.service";
import { authenticateRequest } from "../services/installation-auth";
import { processPoll } from "../services/poll.service";
import { openSupportTicket } from "../services/support.service";
import { handleTransferRequest } from "../services/transfer.service";
import { parseJsonBody, parseStrict, rawBodyOf } from "./body";
import { proxyTrustFrom } from "./client-address";
import { DEALER_PORTAL_ROUTES } from "./dealer-routes";
import { accessLog, errorHandler, notFound } from "./error-handler";
import { createPortalRouter } from "./portal-http";
import { qrPage } from "./qr-page";
import { FixedWindowLimiter, rateLimit, rateLimited } from "./rate-limit";
import { mountDistributionPublic } from "./distribution-public";
import { createWebAppRouter } from "./web-static";

/** Kurulum (ya da kurulumsuz anahtar) başına sınır — imza doğrulandıktan SONRA sayılır (başkasının kotası tüketilemez). */
type ScopeLimit = (scope: string) => void;

function scopeLimiter(perMinute: number): ScopeLimit {
  const limiter = new FixedWindowLimiter(perMinute);
  return (scope) => {
    const retry = limiter.hit(scope);
    if (retry !== null) throw rateLimited(retry);
  };
}

// Her uçta sıra: ham gövde → KATI şema (ucuz) → imza → uca özgü ön denetim → kurulum hız sınırı → nonce → kilit/tx.
interface SignedCall {
  readonly ctx: VendorContext;
  readonly header: unknown;
  readonly raw: Buffer;
  readonly nowMs: number;
  readonly limit: ScopeLimit;
}

async function activation(c: SignedCall) {
  const body = parseStrict(ActivateRequestSchema, parseJsonBody(c.raw));
  return handleActivation(c.ctx, { header: c.header, rawBody: c.raw, body, nowMs: c.nowMs, limit: c.limit });
}

async function poll(c: SignedCall & { readonly purposes: ("yokla" | "cevrimdisi")[] }) {
  const body = parseStrict(PollRequestSchema, parseJsonBody(c.raw));
  const auth = await authenticateRequest({
    header: c.header,
    rawBody: c.raw,
    purposes: c.purposes,
    nowMs: c.nowMs,
    limit: c.limit,
    // Yetenek İMZALI gövdeden (gövde özeti imzada): kapanış kirasını anlamayan eski fabrika bugünkü 403'ü alır.
    allowEnded: acceptsClosingLease(body.yetenekler),
  });
  return processPoll(c.ctx, auth, body, c.nowMs);
}

export function createPublicApp(ctx: VendorContext, hub: DoorbellHub | null): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(accessLog);
  const raw = express.raw({ type: () => true, limit: "96kb" });
  const trust = proxyTrustFrom(ctx.config);
  const limit = scopeLimiter(ctx.config.V1_HIZ_KURULUM_DK);

  app.get("/saglik", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ success: true });
  });

  // İstemci adresi başına sınır: gövde okunmadan, imza doğrulanmadan ÖNCE (en ucuz kapı).
  app.use("/v1", rateLimit({ perMinute: ctx.config.V1_HIZ_IP_DK, trust }));

  app.post(ENDPOINTS.ACTIVATE, raw, async (req: Request, res: Response) => {
    res.json(await activation({ ctx, header: req.get(REQUEST_HEADER), raw: rawBodyOf(req.body), nowMs: Date.now(), limit }));
  });

  app.post(ENDPOINTS.POLL, raw, async (req: Request, res: Response) => {
    res.json(await poll({ ctx, header: req.get(REQUEST_HEADER), raw: rawBodyOf(req.body), nowMs: Date.now(), limit, purposes: ["yokla"] }));
  });

  // Çevrimdışı/aktarma: dış istek imzasızdır (panel ya da telefon taşır); güven zarfın içindeki
  // kurulum imzalı istekten gelir — yanıt imzalı belgeler taşıdığından taşıyıcı onu taklit edemez.
  app.post(ENDPOINTS.OFFLINE, raw, async (req: Request, res: Response) => {
    const nowMs = Date.now();
    const outer = parseStrict(OfflineRequestSchema, parseJsonBody(rawBodyOf(req.body)));
    const opened = openEnvelope(outer.zarf);
    if (!opened.ok) throw new VendorError(400, "ZARF_BICIM", opened.message);
    const inner = parseJsonBody(opened.value.body);
    const isActivation = isPlainObject(inner) && "kod" in inner;
    const call: SignedCall = { ctx, header: opened.value.request, raw: opened.value.body, nowMs, limit };
    res.json(isActivation ? await activation(call) : await poll({ ...call, purposes: ["yokla", "cevrimdisi"] }));
  });

  app.post(ENDPOINTS.TRANSFER, raw, async (req: Request, res: Response) => {
    const body = rawBodyOf(req.body);
    const parsed = parseStrict(TransferRequestSchema, parseJsonBody(body));
    res.json(await handleTransferRequest(ctx, { header: req.get(REQUEST_HEADER), rawBody: body, body: parsed, nowMs: Date.now(), limit }));
  });

  app.post(ENDPOINTS.DR_TAKEOVER, raw, async (req: Request, res: Response) => {
    const nowMs = Date.now();
    const body = rawBodyOf(req.body);
    const parsed = parseStrict(DrTakeoverRequestSchema, parseJsonBody(body));
    const auth = await authenticateRequest({
      header: req.get(REQUEST_HEADER),
      rawBody: body,
      purposes: ["dr-devral"],
      nowMs,
      limit,
      precheck: async (a) => void (await drTakeoverTarget(a.installation, parsed)),
    });
    res.json(await processDrTakeover(ctx, auth, parsed, nowMs));
  });

  // DESTEK: gövde küçük ek (≤1 MB görüntü, base64) taşıyabilir — yalnız bu uçta daha geniş ham sınır.
  // Büyük ek bu gövdede değil `/y/<belirteç>` yükleme bağlantısıyla gider (3d-1).
  const rawSupport = express.raw({ type: () => true, limit: "2mb" });
  app.post(ENDPOINTS.SUPPORT, rawSupport, async (req: Request, res: Response) => {
    const nowMs = Date.now();
    const body = rawBodyOf(req.body);
    const parsed = parseStrict(SupportRequestSchema, parseJsonBody(body));
    const auth = await authenticateRequest({ header: req.get(REQUEST_HEADER), rawBody: body, purposes: ["destek"], nowMs, limit });
    res.json(await openSupportTicket(auth, parsed));
  });

  // KAPI ZİLİ (SSE): kurulum imzalı abonelik; içerik taşımaz, yalnız "şimdi yokla". Kurulum başına ≤ ZIL_AZAMI_ABONE.
  app.get(ENDPOINTS.DOORBELL, async (req: Request, res: Response) => {
    if (!hub) throw new VendorError(500, "SUNUCU_HATASI", "Kapı zili bu süreçte kapalı");
    const auth = await authenticateRequest({ header: req.get(REQUEST_HEADER), rawBody: Buffer.alloc(0), purposes: ["zil"], nowMs: Date.now(), limit });
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(": bagli\n\n");
    hub.subscribe(auth.installation.id, res);
  });

  app.get("/q", rateLimit({ perMinute: ctx.config.QR_HIZ_SINIRI_DK, trust }), qrPage);

  // Dağıtım (Faz 3d): /d indirme · /y müşteri yüklemesi · /yayin/bildirim (yayıncı imzalı).
  mountDistributionPublic(app, ctx);

  app.use("/bayi/api", createPortalRouter(ctx, "GENEL", DEALER_PORTAL_ROUTES));
  app.use("/bayi", createWebAppRouter(ctx.config.PORTAL_WEB_DIZINI, "bayi"));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
