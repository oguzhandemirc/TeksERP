// =============================================================================
// TeksERP — MAKİNE KARTI İMZA DOĞRULAYICISI (verifyToken DEĞİL) · /api/machine-signals
// =============================================================================
// Kart oturum açmaz: her istek `x-collector-id` + zaman damgası + nonce + HMAC imzasıyla gelir
// (protokol: docs/design/MAKINE-KART-PROTOKOLU.md). FAIL-CLOSED: başlık eksik/biçimsiz, damga ±5 dk
// dışı, nonce tekrarı, bilinmeyen/iptal/onaysız kart, halkada anahtarı olmayan tohum, imza tutmazsa 401.
// `req.user` DOĞMAZ; doğrulanan kart `req.collector`a yazılır. Hız sınırı kart başına (bellek içi —
// backend tek süreç). Sır/imza hiçbir log'a ve hata ayrıntısına girmez.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { DeviceStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { getShortCredentialKeyRing } from "../lib/short-credential/keyring";
import { collectorSignatureMatches, collectorSigningInput, deriveCollectorSecret } from "../services/helpers/collector-secret.helper";
import "../types/express-augment";

export const COLLECTOR_SIGNAL_PREFIX = "/api/machine-signals";
export const COLLECTOR_CLOCK_SKEW_SEC = 300;
const NONCE_TTL_MS = 2 * COLLECTOR_CLOCK_SKEW_SEC * 1000;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COLLECTOR_RATE_WINDOW_MS = 60_000;
export const COLLECTOR_RATE_MAX = 600;
const MAP_CAP = 50_000;

/** Ham gövdeyi yalnız kart yolunda saklar (imza ham bayta atılır) — global JSON ayrıştırıcının `verify`ı. */
export function captureCollectorRawBody(req: Request, _res: Response, buf: Buffer): void {
  if ((req.originalUrl ?? req.url ?? "").startsWith(COLLECTOR_SIGNAL_PREFIX)) req.collectorRawBody = Buffer.from(buf);
}

const seenNonces = new Map<string, number>();
const rateWindows = new Map<string, { start: number; count: number }>();

function prune<V>(map: Map<string, V>, expired: (v: V) => boolean): void {
  if (map.size < MAP_CAP) return;
  for (const [k, v] of map) if (expired(v)) map.delete(k);
  if (map.size >= MAP_CAP) map.clear();
}

/** Bekçi içindir: bellek içi nonce ve hız pencerelerini sıfırlar. */
export function resetCollectorAuthStateForTests(): void {
  seenNonces.clear();
  rateWindows.clear();
}

function header(req: Request, name: string): string {
  const v = req.headers[name];
  return typeof v === "string" ? v.trim() : "";
}

function denied(code: string, message = "Kart kimliği doğrulanamadı."): AppError {
  return new AppError(message, 401, true, { code });
}

function rateLimit(id: string, now: number): void {
  prune(rateWindows, (w) => now - w.start >= COLLECTOR_RATE_WINDOW_MS);
  const w = rateWindows.get(id);
  if (!w || now - w.start >= COLLECTOR_RATE_WINDOW_MS) {
    rateWindows.set(id, { start: now, count: 1 });
    return;
  }
  w.count += 1;
  if (w.count > COLLECTOR_RATE_MAX) {
    throw new AppError("Kart çok sık istek gönderiyor — biraz sonra yeniden deneyin.", 429, true, { code: "COLLECTOR_RATE_LIMITED" });
  }
}

/** Damga: Unix saniyesi; ±5 dk dışı reddedilir ve sunucu saati döner (kart saatini düzeltsin). */
function assertFresh(timestamp: string, now: number): void {
  if (!/^\d{9,11}$/.test(timestamp)) throw denied("COLLECTOR_AUTH_HEADERS");
  const skew = Math.abs(now / 1000 - Number(timestamp));
  if (skew > COLLECTOR_CLOCK_SKEW_SEC) {
    throw new AppError("Kart saati sunucudan 5 dakikadan fazla sapmış.", 401, true, { code: "COLLECTOR_CLOCK_SKEW", serverTime: Math.floor(now / 1000) });
  }
}

export async function verifyCollectorSignature(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const now = Date.now();
    const id = header(req, "x-collector-id").toLowerCase();
    const timestamp = header(req, "x-collector-timestamp");
    const nonce = header(req, "x-collector-nonce");
    const signature = header(req, "x-collector-signature").toLowerCase();
    if (!UUID_RE.test(id) || !NONCE_RE.test(nonce) || !signature) throw denied("COLLECTOR_AUTH_HEADERS");
    rateLimit(id, now);
    assertFresh(timestamp, now);
    const nonceKey = `${id}:${nonce}`;
    const seenUntil = seenNonces.get(nonceKey);
    if (seenUntil !== undefined && seenUntil > now) throw denied("COLLECTOR_NONCE_REPLAY", "Bu istek daha önce kullanılmış (nonce tekrarı).");

    const row = await prisma.machineCollector.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, isActive: true, revokedAt: true, secretSeed: true, machines: { select: { machineId: true } } },
    });
    if (!row || row.revokedAt || !row.isActive || row.status !== DeviceStatus.APPROVED) throw denied("COLLECTOR_AUTH_FAILED");
    const ring = getShortCredentialKeyRing();
    const secret = ring.ok ? deriveCollectorSecret(ring.ring, row.id, row.secretSeed) : null;
    if (!secret) throw denied("COLLECTOR_AUTH_FAILED");
    const input = collectorSigningInput({
      method: req.method, path: (req.originalUrl ?? "").split("?")[0]!, timestamp, nonce, body: req.collectorRawBody ?? Buffer.alloc(0),
    });
    if (!collectorSignatureMatches(secret, input, signature)) throw denied("COLLECTOR_AUTH_FAILED");

    // Nonce yalnız GEÇERLİ imzadan sonra kaydedilir — sahte istek meşru kartın nonce'unu yakamaz.
    prune(seenNonces, (until) => until <= now);
    seenNonces.set(nonceKey, now + NONCE_TTL_MS);
    req.collector = { id: row.id, name: row.name, machineIds: row.machines.map((m) => m.machineId) };
    next();
  } catch (e) {
    next(e);
  }
}
