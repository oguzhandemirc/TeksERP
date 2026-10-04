// WEB ARAYÜZÜ STATİK SERVİSİ — derlenmiş `satici/web` çıktısı API ile AYNI kökenden sunulur (çerez
// yolları `/portal` · `/bayi` korunur, CORS gerekmez). Her dinleyici yalnız KENDİ uygulamasının
// dizinini bilir: satıcı arayüzü (`dist/portal`) TAILNET ve ERİŞİM'de `/portal`, bayi arayüzü
// (`dist/bayi`) yalnız GENEL'de `/bayi`. `/api` altı ASLA HTML'e düşmez (bilinmeyen uç JSON 404 kalır).
import { existsSync } from "node:fs";
import path from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { notFound } from "./error-handler";

export type WebApp = "portal" | "bayi";

/** Vite çıktısındaki giriş dosyası (uygulama başına ayrı derleme; `satici/web/vite.config.ts`). */
export const WEB_APP_ENTRY: Readonly<Record<WebApp, string>> = { portal: "portal.html", bayi: "bayi.html" };

/** Satır içi betik/stil yok, dış kaynak yok, çerçeveye gömülmez. */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(res: Response): void {
  res.set({
    "Content-Security-Policy": WEB_CSP,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
}

export function webAppDir(root: string, app: WebApp): string {
  return path.join(root, app);
}

export function webAppAvailable(root: string, app: WebApp): boolean {
  return existsSync(path.join(webAppDir(root, app), WEB_APP_ENTRY[app]));
}

export function createWebAppRouter(root: string, app: WebApp): Router {
  const dir = webAppDir(root, app);
  const entry = path.join(dir, WEB_APP_ENTRY[app]);
  const router = express.Router();
  const isApi = (req: Request): boolean => req.path === "/api" || req.path.startsWith("/api/");

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (isApi(req)) return next("router");
    securityHeaders(res);
    next();
  });
  router.use(
    express.static(dir, {
      index: false,
      redirect: false,
      dotfiles: "deny",
      fallthrough: true,
      setHeaders: (res, file) => {
        // Vite içerik özetli adlar üretir: assets/ değişmez; giriş HTML'i her açılışta tazelenir.
        const immutable = file.startsWith(path.join(dir, "assets") + path.sep);
        res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-store");
      },
    }),
  );
  // İstemci tarafı yönlendirme: uzantısız GET/HEAD giriş HTML'ini alır; eksik varlık (uzantılı) 404.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || path.extname(req.path) !== "") return next();
    if (!existsSync(entry)) return next();
    res.set("Cache-Control", "no-store");
    res.sendFile(entry, (err) => {
      if (err && !res.headersSent) notFound(req, res);
    });
  });
  return router;
}
