// İÇ DİNLEYİCİ — satıcı iç API'si (`/ic/v1/*`, patron bulutu → satıcı) YALNIZ burada; genel dinleyici ve
// ERİŞİM portalı bu yolu bilmez (404). Kapı üç koşullu ve FAIL-CLOSED:
//   (1) istek iç dinleyicinin SOKETİNE gelmiş  (2) kaynak adres IC_KAYNAK_AGLARI'nda (soketten; başlık
//   OKUNMAZ; verilmezse yalnız geri döngü) — biri tutmazsa 404 · (3) Bearer ortak sırla sabit zamanlı eşit —
//   değilse 401 IC_KIMLIK_GECERSIZ (404 DEĞİL: patron 404'ü "kurulum yok" okuyup kaydı pasife çeker).
import type { AddressInfo } from "node:net";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { InternalBearer } from "../lib/internal-bearer";
import { VendorError, badRequest, notFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import {
  InternalDoorbellSchema,
  doorbellTargets,
  readInstallationForCloud,
  ringInstallations,
  type InternalApiCounters,
} from "../services/internal-api.service";
import { UuidSchema } from "../lisans-protokol";
import { blockListOf, inList, stripMapped } from "./client-address";
import { accessLog, errorHandler, notFound } from "./error-handler";
import { FixedWindowLimiter, rateLimited } from "./rate-limit";
import { LOOPBACK_NETWORKS } from "./listener-socket";

export const INTERNAL_PREFIX = "/ic/v1";

/** İç API'nin kaynak ağları: yapılandırılmışsa YALNIZ onlar, değilse geri döngü. */
export function internalSourceNetworks(configured: readonly string[] | undefined): readonly string[] {
  return configured && configured.length > 0 ? configured : LOOPBACK_NETWORKS;
}

/** Ara katman: dinleyici soketi + kaynak ağı. `listener()` null ise (henüz dinlemiyor) RED. */
export function requireInternalSocket(listener: () => AddressInfo | string | null, networks: readonly string[]) {
  const allowed = blockListOf(networks);
  return (req: Request, res: Response, next: NextFunction): void => {
    const bound = listener();
    const onListener =
      bound !== null &&
      typeof bound === "object" &&
      req.socket.localPort === bound.port &&
      stripMapped(req.socket.localAddress) === stripMapped(bound.address);
    if (!onListener || !inList(allowed, stripMapped(req.socket.remoteAddress))) {
      notFound(req, res);
      return;
    }
    next();
  };
}

/** Ara katman: Bearer ortak sır. Eksik, biçimsiz ve yanlış başlık AYNI yanıtı alır. */
export function requireBearer(bearer: InternalBearer) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!bearer.matches(req.headers.authorization)) {
      next(new VendorError(401, "IC_KIMLIK_GECERSIZ", "İç API kimliği geçersiz"));
      return;
    }
    next();
  };
}

function endpointOf(path: string): string {
  if (path.startsWith(`${INTERNAL_PREFIX}/kurulum/`)) return "kurulum";
  if (path === `${INTERNAL_PREFIX}/zil`) return "zil";
  return "diger";
}

export interface InternalAppDeps {
  readonly bearer: InternalBearer;
  readonly counters: InternalApiCounters;
  readonly listener: () => AddressInfo | string | null;
}

export function createInternalApp(ctx: VendorContext, deps: InternalAppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(accessLog);
  app.use((req, res, next) => {
    // Uç, yönlendirme `req.url`i kırpmadan ÖNCE okunur.
    const endpoint = endpointOf(req.path);
    res.on("finish", () => deps.counters.bump(endpoint, res.statusCode));
    next();
  });
  app.use(requireInternalSocket(deps.listener, internalSourceNetworks(ctx.config.IC_KAYNAK_AGLARI)));

  const zilLimiter = new FixedWindowLimiter(ctx.config.IC_ZIL_HIZ_DK);
  const api = express.Router();
  api.use(requireBearer(deps.bearer));
  api.get("/kurulum/:kurulumId", async (req, res) => {
    const id = String(req.params.kurulumId);
    if (!UuidSchema.safeParse(id).success) throw badRequest("Kurulum kimliği biçimsiz");
    const view = await readInstallationForCloud(prisma, id);
    if (!view) throw notFoundError("Kurulum");
    res.set("Cache-Control", "no-store").json(view);
  });
  api.post("/zil", express.json({ limit: "2kb", strict: true }), async (req, res) => {
    const body = InternalDoorbellSchema.safeParse(req.body);
    if (!body.success) throw badRequest("Zil gövdesi geçersiz ({v:1, tesisId, konu: gelen-kutusu|rapor|ozet})");
    const targets = await doorbellTargets(prisma, body.data.tesisId);
    if (targets === null) throw notFoundError("Tesis");
    const now = Date.now();
    const allowed: string[] = [];
    let retry = 0;
    for (const id of targets) {
      const wait = zilLimiter.hit(id, now);
      if (wait === null) allowed.push(id);
      else retry = Math.max(retry, wait);
    }
    if (targets.length > 0 && allowed.length === 0) {
      res.set("Retry-After", String(retry));
      throw rateLimited(retry);
    }
    await ringInstallations(prisma, allowed, body.data.konu);
    res.set("Cache-Control", "no-store").json({ v: 1, calinan: allowed.length });
  });
  app.use(INTERNAL_PREFIX, api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
