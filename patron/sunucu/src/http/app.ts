// Tek dinleyici, iki yüzey: `/v1/*` fabrika kanalı (kurulum imzalı; eşitleme rolü) + `/api/*` hesap
// API'si (Bearer oturum; uygulama rolü). Public `/saglik` yalnız {success:true} döner (sayı sızdırmaz).
import express, { type Express } from "express";
import type { CloudContext } from "../services/context";
import { createApiRouter } from "./api-routes";
import { accessLog, errorHandler, notFoundHandler } from "./error-handler";
import { createFactoryRouter } from "./factory-routes";

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
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
