// TAILNET DİNLEYİCİSİ — portal (1f) ve kök parolası isteyen uçlar YALNIZ burada.
// Kapı iki koşullu ve FAIL-CLOSED: istek (1) tailnet dinleyicisinin soketine gelmiş olmalı ve
// (2) kaynak adresi tailnet/geri döngü ağlarında olmalı; biri tutmazsa 404 (varlık sızdırılmaz).
// Bu dilimde portal JSON API'si yok: yalnız sağlık ucu (sayılar; sır ve kimlik yok).
import { BlockList, isIPv4, isIPv6, type AddressInfo } from "node:net";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { auditFailureCount } from "../lib/audit";
import type { VendorContext } from "../services/context";
import type { DoorbellHub } from "../services/doorbell";
import { accessLog, errorHandler, notFound } from "./error-handler";

/** Geri döngü + Tailscale CGNAT (100.64.0.0/10) ve Tailscale IPv6 ULA'sı. */
export const TAILNET_SOURCE_NETWORKS = ["127.0.0.0/8", "::1/128", "100.64.0.0/10", "fd7a:115c:a1e0::/48"] as const;

const sources = new BlockList();
for (const cidr of TAILNET_SOURCE_NETWORKS) {
  const [net, bits] = cidr.split("/");
  sources.addSubnet(net!, Number(bits), isIPv6(net!) ? "ipv6" : "ipv4");
}

function stripMapped(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") && isIPv4(address.slice(7)) ? address.slice(7) : address;
}

export function isTailnetSource(remote: string | undefined): boolean {
  const a = stripMapped(remote);
  if (isIPv4(a)) return sources.check(a, "ipv4");
  if (isIPv6(a)) return sources.check(a, "ipv6");
  return false;
}

/** Ara katman: dinleyici soketi + kaynak ağı. `listener()` null ise (henüz dinlemiyor) RED. */
export function requireTailnet(listener: () => AddressInfo | string | null) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const bound = listener();
    const onListener =
      bound !== null &&
      typeof bound === "object" &&
      req.socket.localPort === bound.port &&
      stripMapped(req.socket.localAddress) === stripMapped(bound.address);
    if (!onListener || !isTailnetSource(req.socket.remoteAddress)) {
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
  app.use(requireTailnet(listener));
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
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
