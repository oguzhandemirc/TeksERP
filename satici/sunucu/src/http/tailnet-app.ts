// TAILNET DİNLEYİCİSİ — portal (1f) ve kök parolası isteyen uçlar YALNIZ burada.
// Kapı iki koşullu ve FAIL-CLOSED: istek (1) tailnet dinleyicisinin soketine gelmiş olmalı ve
// (2) kaynak adresi tailnet ağında olmalı (geri döngü yalnız TAILNET_LOOPBACK=1 iken); biri tutmazsa 404.
// Portal JSON API'si /portal/api altında (portal-routes.ts); /portal/saglik yalnız sayılar taşır;
// satıcı web arayüzü (satici/web dist/portal) /portal altında, kapının ARKASINDA.
import type { AddressInfo } from "node:net";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { auditFailureCount } from "../lib/audit";
import type { VendorContext } from "../services/context";
import type { DoorbellHub } from "../services/doorbell";
import { blockListOf, inList, stripMapped } from "./client-address";
import { accessLog, errorHandler, notFound } from "./error-handler";
import { createPortalRouter } from "./portal-http";
import { VENDOR_PORTAL_ROUTES } from "./portal-routes";
import { createWebAppRouter } from "./web-static";

/** Tailscale CGNAT (100.64.0.0/10) ve Tailscale IPv6 ULA'sı — her zaman tailnet kaynağı. */
export const TAILNET_SOURCE_NETWORKS = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"] as const;
/** Geri döngü: YALNIZ TAILNET_LOOPBACK=1 iken (Tailscale kurulana dek SSH tüneli) tailnet sayılır. */
export const LOOPBACK_NETWORKS = ["127.0.0.0/8", "::1/128"] as const;

const tailnet = blockListOf(TAILNET_SOURCE_NETWORKS);
const loopback = blockListOf(LOOPBACK_NETWORKS);

export function isTailnetSource(remote: string | undefined, allowLoopback: boolean): boolean {
  const a = stripMapped(remote);
  return inList(tailnet, a) || (allowLoopback && inList(loopback, a));
}

/** Ara katman: dinleyici soketi + kaynak ağı. `listener()` null ise (henüz dinlemiyor) RED. */
export function requireTailnet(listener: () => AddressInfo | string | null, allowLoopback: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const bound = listener();
    const onListener =
      bound !== null &&
      typeof bound === "object" &&
      req.socket.localPort === bound.port &&
      stripMapped(req.socket.localAddress) === stripMapped(bound.address);
    if (!onListener || !isTailnetSource(req.socket.remoteAddress, allowLoopback)) {
      notFound(req, res);
      return;
    }
    next();
  };
}

export function createTailnetApp(ctx: VendorContext, hub: DoorbellHub | null, listener: () => AddressInfo | string | null): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(accessLog);
  app.use(requireTailnet(listener, ctx.config.TAILNET_LOOPBACK === "1"));
  app.use("/portal/api", createPortalRouter(ctx, "TAILNET", VENDOR_PORTAL_ROUTES));
  const portal = express.Router();
  portal.get("/saglik", (_req, res) => {
    const now = Date.now();
    res.set("Cache-Control", "no-store").json({
      success: true,
      data: {
        zil: { dinliyor: hub?.listening() ?? false, abone: hub?.subscriberCount() ?? 0, teslim: hub?.delivered() ?? 0 },
        anahtarlar: {
          capa: ctx.keys.anchorSource,
          altGecerli: ctx.keys.subKeys.filter((k) => k.kind === "ALT").length,
          indirmeVar: ctx.keys.downloadKey(now) !== null,
          uyariSayisi: ctx.keys.warnings.length,
        },
        denetimYazmaHatasi: auditFailureCount(),
      },
    });
  });
  app.use("/portal", portal);
  app.use("/portal", createWebAppRouter(ctx.config.PORTAL_WEB_DIZINI, "portal"));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
