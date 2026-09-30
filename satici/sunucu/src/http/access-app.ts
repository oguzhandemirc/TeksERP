// ERİŞİM DİNLEYİCİSİ — satıcı portalının internetten yolu (portal.<alan>, Cloudflare proxy + Access).
// Kapılar (sırayla, hepsi FAIL-CLOSED, red 404 — varlık sızdırılmaz):
//   (1) istek ERİŞİM dinleyicisinin soketine gelmiş olmalı;
//   (2) Access yapılandırması var (takım alanı + AUD) ve `Cf-Access-Jwt-Assertion` doğrulanıyor — HER istekte,
//       statik dosyalar dahil; kaynak IP'ye, Host başlığına, istemci beyanına güvenilmez;
//   (3) kök parolalı rota bu yolda YOK: tailnet kaynağı ara katmanı (requireTailnet) gövde okunmadan 404 verir.
// Arkasında tailnet'le aynı portal (parola + TOTP, oturum ERISIM dinleyicisine bağlı) ve aynı web arayüzü.
import type { AddressInfo } from "node:net";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { VendorContext } from "../services/context";
import { ACCESS_HEADER, type AccessRejection, type AccessVerifier } from "./access-jwt";
import { createDistributionRawRouter } from "./distribution-raw";
import { accessLog, errorHandler, notFound } from "./error-handler";
import { createPortalRouter } from "./portal-http";
import { VENDOR_PORTAL_ROUTES } from "./portal-routes";
import { arrivedOn, requireTailnet } from "./tailnet-app";
import { createWebAppRouter } from "./web-static";

type ListenerOf = () => AddressInfo | string | null;

export interface AccessAppDeps {
  /** Bu uygulamanın (ERİŞİM) dinleyicisi. */
  readonly listener: ListenerOf;
  /** Tailnet dinleyicisi — kök parolalı rota kapısı onun soketini ister (burada hiçbir istek geçemez). */
  readonly tailnetListener: ListenerOf;
  /** null → Access yapılandırılmamış: genel portal KAPALI, her istek 404. */
  readonly verifier: AccessVerifier | null;
}

/** Red gerekçesi günlüğü: gerekçe başına dakikada bir satır (doğrudan kökene gelen sel günlüğü boğmasın). */
function rejectionLogger(nowMs: () => number = Date.now): (reason: AccessRejection | "KAPALI", detail: string) => void {
  const last = new Map<string, { at: number; suppressed: number }>();
  return (reason, detail) => {
    const entry = last.get(reason);
    const now = nowMs();
    if (entry && now - entry.at < 60_000) {
      entry.suppressed++;
      return;
    }
    const extra = entry && entry.suppressed > 0 ? ` (+${entry.suppressed} bastırıldı)` : "";
    last.set(reason, { at: now, suppressed: 0 });
    console.warn(`[satici] erisim: RED ${reason} — ${detail}${extra}`);
  };
}

export function requireOwnListener(listener: ListenerOf) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!arrivedOn(req, listener())) {
      notFound(req, res);
      return;
    }
    next();
  };
}

/** Access JWT kapısı; geçen isteğin kimliği `res.locals.erisimKimligi`nde (yalnız bilgi, karar vermez). */
export function requireAccessJwt(verifier: AccessVerifier | null, log = rejectionLogger()) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!verifier) {
      log("KAPALI", "Access ayarı eksik (CF_ACCESS_TAKIM_ALANI / CF_ACCESS_AUD / CF_ACCESS_JWKS_DOSYASI)");
      notFound(req, res);
      return;
    }
    verifier.verify(req.headers[ACCESS_HEADER]).then(
      (result) => {
        if (!result.ok) {
          log(result.reason, result.detail);
          notFound(req, res);
          return;
        }
        res.locals.erisimKimligi = result.identity;
        next();
      },
      (err: unknown) => {
        log("JWKS", err instanceof Error ? err.message : String(err));
        notFound(req, res);
      },
    );
  };
}

export function createAccessApp(ctx: VendorContext, deps: AccessAppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(accessLog);
  app.use(requireOwnListener(deps.listener));
  app.use(requireAccessJwt(deps.verifier));
  const rootPasswordGate = requireTailnet(deps.tailnetListener, ctx.config.TAILNET_LOOPBACK === "1");
  app.use("/portal/api/ham", createDistributionRawRouter(ctx, "ERISIM"));
  app.use("/portal/api", createPortalRouter(ctx, "ERISIM", VENDOR_PORTAL_ROUTES, { rootPasswordGate }));
  app.get("/", (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store").redirect(302, "/portal/");
  });
  app.use("/portal", createWebAppRouter(ctx.config.PORTAL_WEB_DIZINI, "portal"));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
