// GENEL DİNLEYİCİ (Traefik/Cloudflare arkası): /v1/* protokol uçları + /q QR sayfası + /bayi/api
// (yalnız BAYI rolünün alt-portalı). Satıcı portalı ve kök parolası isteyen hiçbir uç burada YOK.
// Sıkıştırma ara katmanı bilerek yok: zil (SSE) akışı `no-transform` ile tamponsuz gitmeli.
import express, { type Express, type Request, type Response } from "express";
import {
  ActivateRequestSchema,
  DrTakeoverRequestSchema,
  ENDPOINTS,
  OfflineRequestSchema,
  PollRequestSchema,
  REQUEST_HEADER,
  TransferRequestSchema,
  isPlainObject,
  openEnvelope,
} from "../lisans-protokol";
import { VendorError } from "../lib/errors";
import { processActivation } from "../services/activation.service";
import type { VendorContext } from "../services/context";
import type { DoorbellHub } from "../services/doorbell";
import { processDrTakeover } from "../services/dr.service";
import { authenticateRequest } from "../services/installation-auth";
import { processPoll } from "../services/poll.service";
import { processTransferRequest } from "../services/transfer.service";
import { parseJsonBody, parseStrict, rawBodyOf } from "./body";
import { DEALER_PORTAL_ROUTES } from "./dealer-routes";
import { accessLog, errorHandler, notFound } from "./error-handler";
import { createPortalRouter } from "./portal-http";
import { qrPage } from "./qr-page";
import { rateLimit } from "./rate-limit";

/** Gövdedeki açık anahtar (etkinleştirme/taşıma): imzayı doğrulamadan önce gerekir. */
function bodyKey(json: Record<string, unknown>): string {
  if (typeof json.acikAnahtar !== "string") throw new VendorError(400, "GOVDE_GECERSIZ", "Gövdede kurulum açık anahtarı yok");
  return json.acikAnahtar;
}

async function handleActivation(ctx: VendorContext, header: unknown, raw: Buffer, nowMs: number) {
  const json = parseJsonBody(raw);
  const auth = await authenticateRequest({ header, rawBody: raw, purposes: ["etkinlestir"], nowMs, keyFromBody: bodyKey(json) });
  return processActivation(ctx, auth, parseStrict(ActivateRequestSchema, json), nowMs);
}

async function handlePoll(ctx: VendorContext, header: unknown, raw: Buffer, nowMs: number, purposes: ("yokla" | "cevrimdisi")[]) {
  const json = parseJsonBody(raw);
  const auth = await authenticateRequest({ header, rawBody: raw, purposes, nowMs });
  return processPoll(ctx, auth, parseStrict(PollRequestSchema, json), nowMs);
}

export function createPublicApp(ctx: VendorContext, hub: DoorbellHub | null): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(accessLog);
  const raw = express.raw({ type: () => true, limit: "96kb" });

  app.get("/saglik", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ success: true });
  });

  app.post(ENDPOINTS.ACTIVATE, raw, async (req: Request, res: Response) => {
    res.json(await handleActivation(ctx, req.get(REQUEST_HEADER), rawBodyOf(req.body), Date.now()));
  });

  app.post(ENDPOINTS.POLL, raw, async (req: Request, res: Response) => {
    res.json(await handlePoll(ctx, req.get(REQUEST_HEADER), rawBodyOf(req.body), Date.now(), ["yokla"]));
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
    res.json(
      isActivation
        ? await handleActivation(ctx, opened.value.request, opened.value.body, nowMs)
        : await handlePoll(ctx, opened.value.request, opened.value.body, nowMs, ["yokla", "cevrimdisi"]),
    );
  });

  app.post(ENDPOINTS.TRANSFER, raw, async (req: Request, res: Response) => {
    const nowMs = Date.now();
    const body = rawBodyOf(req.body);
    const json = parseJsonBody(body);
    const auth = await authenticateRequest({ header: req.get(REQUEST_HEADER), rawBody: body, purposes: ["tasima"], nowMs, keyFromBody: bodyKey(json) });
    res.json(await processTransferRequest(ctx, auth, parseStrict(TransferRequestSchema, json), nowMs));
  });

  app.post(ENDPOINTS.DR_TAKEOVER, raw, async (req: Request, res: Response) => {
    const nowMs = Date.now();
    const body = rawBodyOf(req.body);
    const json = parseJsonBody(body);
    const auth = await authenticateRequest({ header: req.get(REQUEST_HEADER), rawBody: body, purposes: ["dr-devral"], nowMs });
    res.json(await processDrTakeover(ctx, auth, parseStrict(DrTakeoverRequestSchema, json), nowMs));
  });

  // KAPI ZİLİ (SSE): kurulum imzalı abonelik; içerik taşımaz, yalnız "şimdi yokla".
  app.get(ENDPOINTS.DOORBELL, async (req: Request, res: Response) => {
    if (!hub) throw new VendorError(500, "SUNUCU_HATASI", "Kapı zili bu süreçte kapalı");
    const auth = await authenticateRequest({ header: req.get(REQUEST_HEADER), rawBody: Buffer.alloc(0), purposes: ["zil"], nowMs: Date.now() });
    if (auth.role === "PENDING_TRANSFER") {
      throw new VendorError(409, "TASIMA_ONAYI_BEKLIYOR", "Bu makinenin taşıma talebi onay bekliyor");
    }
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

  app.get("/q", rateLimit({ perMinute: ctx.config.QR_HIZ_SINIRI_DK, proxyHeader: ctx.config.VEKIL_IP_BASLIGI }), qrPage);

  app.use("/bayi/api", createPortalRouter(ctx, "GENEL", DEALER_PORTAL_ROUTES));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
