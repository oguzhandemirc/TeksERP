// =============================================================================
// Hız sınırı KOVA SAHİBİ — IP mi, kanıtlı cihaz mı, oturum sahibi mi (VDS denetimi Y3, 2026-11-01)
// =============================================================================
// Barındırılan kurulumda bütün fabrika tek NAT IP'sinden çıkar: IP başına kova vardiya başında
// 429 üretir ve içerideki tek kötü cihaz herkesin girişini kapatır. Kural (yalnız İNTERNETE AÇIK
// kurulumda — barındırılan sınıf ya da `CLIENT_IP_HEADER` beyanı; LAN bayt-aynı):
//   1. Geçerli cihaz kanıtı taşıyan istek (`req.device.proofVerified`) → cihaz kovası.
//   2. Yazma isteği + imzası doğrulanan oturum belirteci → kullanıcı kovası.
//   3. Kalan → IP kovası; IP `RATE_LIMIT_FACTORY_IPS` beyanındaysa eşik × çarpan.
// Beyan (3) her kurulumda geçerlidir ama varsayılanı boş = bugünkü davranış.
// =============================================================================
import type { Request } from "express";
import { factoryMultiplierFor, readFactoryEgressConfig, type FactoryEgressConfig } from "./factory-egress";
import { resolveClientIp, type RateLimitBucket, type WarnFn } from "./web-hardening";
import { readRequestToken } from "../lib/web-session-cookie";
import { AuthService } from "../services/auth.service";
import { isHostedInstallation } from "../services/helpers/install-class.helper";
import { uyari } from "../lib/logger";
import "../types/express-augment";

export type RateLimitSubject = { key: string; multiplier: number };

export type SubjectResolverDeps = {
  /** İstemci IP'si (giriş kilidiyle AYNI kaynak). */
  clientIp: (req: Request) => string | null;
  /** İnternete açık kurulum mu — kanıtlı cihaz / kullanıcı kovası yalnız orada. */
  internetFacing: () => boolean;
  /** İmzası doğrulanmış oturum belirtecinin kullanıcı kimliği (DB'siz); yoksa null. */
  identifyUser: (req: Request) => string | null;
  factory: FactoryEgressConfig;
};

/** İsteğin sayılacağı kova anahtarı + eşik çarpanı. */
export function resolveRateLimitSubject(req: Request, bucket: RateLimitBucket, deps: SubjectResolverDeps): RateLimitSubject {
  if (deps.internetFacing()) {
    // Kanıt HMAC'i doğrulanmış onaylı cihaz: başlığı uydurmak kanıtı geçmez → kova kaçışı yok.
    if (req.device?.proofVerified) return { key: `${bucket}|dev:${req.device.id}`, multiplier: 1 };
    if (bucket === "write") {
      const userId = deps.identifyUser(req);
      if (userId) return { key: `write|user:${userId}`, multiplier: 1 };
    }
  }
  const ip = deps.clientIp(req);
  if (ip) return { key: `${bucket}|${ip}`, multiplier: factoryMultiplierFor(ip, deps.factory) };
  const h = req.headers["x-device-id"];
  const v = Array.isArray(h) ? h[0] : h;
  if (typeof v === "string" && v.trim()) return { key: `${bucket}|dev:${v.trim().slice(0, 64)}`, multiplier: 1 };
  return { key: `${bucket}|unknown`, multiplier: 1 };
}

/** İmza + süre doğrulamalı (DB'siz) kullanıcı kimliği; iptal edilmiş belirteç yine o kullanıcının kovasına düşer
 *  — kova anahtarı yetki DEĞİLDİR, istek zaten `verifyToken`da 401 alır. */
export function identifyTokenUser(req: Request): string | null {
  const credential = readRequestToken(req);
  if (!credential) return null;
  try {
    const userId = AuthService.verifyToken(credential.token).userId;
    return typeof userId === "string" && userId ? userId : null;
  } catch {
    return null;
  }
}

/** Üretim bağlaması: giriş kilidiyle aynı IP kaynağı, internete açıklık = kenar başlığı ∨ barındırılan sınıf. */
export function buildRateLimitSubjectResolver(
  clientIpHeader: string | null,
  env: NodeJS.ProcessEnv = process.env,
  onWarn: WarnFn = (m) => uyari("web-hardening", m),
): (req: Request, bucket: RateLimitBucket) => RateLimitSubject {
  const deps: SubjectResolverDeps = {
    clientIp: (req) => resolveClientIp(req, clientIpHeader),
    internetFacing: () => Boolean(clientIpHeader) || isHostedInstallation(),
    identifyUser: identifyTokenUser,
    factory: readFactoryEgressConfig(env, onWarn),
  };
  return (req, bucket) => resolveRateLimitSubject(req, bucket, deps);
}
