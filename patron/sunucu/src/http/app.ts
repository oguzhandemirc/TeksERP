// Tek dinleyici, üç yüzey: `/v1/*` fabrika kanalı (kurulum imzalı; eşitleme rolü) + `/api/*` hesap
// API'si (Bearer oturum; uygulama rolü) + web sürümü (`/`, yapılandırıldıysa). Public `/saglik` yalnız
// {success:true} döner (sayı sızdırmaz).
import express, { type Express } from "express";
import { z } from "zod";
import type { CloudContext } from "../services/context";
import { createApiRouter } from "./api-routes";
import { accessLog, errorHandler, notFoundHandler } from "./error-handler";
import { createFactoryRouter } from "./factory-routes";
import { createWebRouter } from "./web-static";

// Doğrulama iletileri kullanıcıya gider (TR-only): zod'un varsayılan İngilizcesi yerine TR yerel ayarı.
z.config(z.locales.tr());

export function createApp(ctx: CloudContext): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(accessLog);
  app.get("/saglik", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ success: true });
  });
  app.use("/v1", createFactoryRouter(ctx));
  app.use("/api", createApiRouter(ctx));
  if (ctx.config.PATRON_WEB_DIZINI) app.use(createWebRouter(ctx.config.PATRON_WEB_DIZINI));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
