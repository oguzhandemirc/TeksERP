// WEB SÜRÜMÜ STATİK SERVİSİ — patron uygulamasının `expo export --platform web` çıktısı API ile AYNI
// kökenden (`/`) sunulur: CORS gerekmez, oturum belirteci başka kökene gitmez. `/api` ve `/v1` altı ASLA
// HTML'e düşmez (bilinmeyen uç JSON 404 kalır); iç ad alanları (`IC_ONEKLER`) web'de de 404'tür ve
// Traefik yönlendiricisi onları hiç almaz (deploy/patron/docker-compose.yml — bekçi iki listeyi eşler).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { notFoundHandler } from "./error-handler";

/** Genel API ad alanları: bilinmeyen alt yol web'e değil JSON 404'e gider. */
export const API_ONEKLER = ["api", "v1"] as const;
/** İç/yönetim ad alanları: patron alanında dışarıya hiç açılmaz (web 404 + Traefik kuralı dışında). */
export const IC_ONEKLER = ["ic", "yonetim"] as const;

export const WEB_GIRIS = "index.html";
/** İçerik özetli adlar (Expo çıktısı): değişmez, uzun önbellek. Geri kalan her şey her açılışta tazelenir. */
export const OZETLI_DIZINLER = ["_expo/static", "assets"] as const;
export const UZUN_ONBELLEK = "public, max-age=31536000, immutable";
export const TAZE = "no-store";

const onekDeseni = (onekler: readonly string[]): RegExp => new RegExp(`^/(${onekler.join("|")})(/|$)`);
const API_YOLU = onekDeseni(API_ONEKLER);
const IC_YOLU = onekDeseni(IC_ONEKLER);

function sha256(metin: string): string {
  return `'sha256-${createHash("sha256").update(metin, "utf8").digest("base64")}'`;
}

/**
 * Giriş HTML'indeki satır içi `<style>`/`<script>` bloklarının özetleri (Expo'nun `expo-reset` stili):
 * CSP `unsafe-inline` olmadan yalnız BU baytlara izin verir; HTML değişirse özet de değişir.
 */
export function satirIciOzetler(html: string): { stil: string[]; betik: string[] } {
  const stil = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => sha256(m[1] ?? ""));
  const betik = [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => sha256(m[1] ?? ""));
  return { stil, betik };
}

/**
 * react-native-web kendi `<style>` ögesini BOŞ yaratıp kuralları CSSOM'la ekler (CSP CSSOM'u kısıtlamaz);
 * boş içeriğin özeti izinli değilse öge engellenir ve sayfa stilsiz çizilir (Chromium'da ölçüldü).
 */
export const BOS_STIL_OZETI = sha256("");

/** Dış kaynak yok, çerçeveye gömülmez; bağlantı yalnız aynı kökene (`/api`). */
export function webCsp(html: string): string {
  const o = satirIciOzetler(html);
  const stil = [...new Set([BOS_STIL_OZETI, ...o.stil])];
  return [
    "default-src 'self'",
    ["script-src 'self'", ...o.betik].join(" "),
    ["style-src 'self'", ...stil].join(" "),
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function webDizinGecerli(dizin: string): boolean {
  return existsSync(path.join(dizin, WEB_GIRIS));
}

export function createWebRouter(dizin: string): Router {
  const kok = path.resolve(dizin);
  const giris = path.join(kok, WEB_GIRIS);
  if (!existsSync(giris)) throw new Error(`Web çıktısı yok: ${giris}`);
  const csp = webCsp(readFileSync(giris, "utf8"));
  const ozetli = OZETLI_DIZINLER.map((d) => path.join(kok, d) + path.sep);
  const router = express.Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (API_YOLU.test(req.path)) return next("router");
    // İç ad alanı, GET/HEAD dışı yöntem ve nokta ile başlayan bölüm (".env", ".git") web'e hiç düşmez.
    if (IC_YOLU.test(req.path) || (req.method !== "GET" && req.method !== "HEAD") || req.path.split("/").some((b) => b.startsWith("."))) {
      notFoundHandler(req, res);
      return;
    }
    res.set({
      "Content-Security-Policy": csp,
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    next();
  });
  router.use(
    express.static(kok, {
      index: false,
      redirect: false,
      dotfiles: "deny",
      fallthrough: true,
      etag: true,
      setHeaders: (res, dosya) => {
        res.setHeader("Cache-Control", ozetli.some((d) => dosya.startsWith(d)) ? UZUN_ONBELLEK : TAZE);
      },
    }),
  );
  // İstemci tarafı yönlendirme: uzantısız yol giriş HTML'ini alır; eksik varlık (uzantılı) 404.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (path.extname(req.path) !== "") return next();
    res.set("Cache-Control", TAZE);
    res.sendFile(giris, (err) => {
      if (err && !res.headersSent) notFoundHandler(req, res);
    });
  });
  return router;
}
