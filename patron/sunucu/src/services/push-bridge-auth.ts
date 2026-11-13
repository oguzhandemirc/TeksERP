// PUSH KÖPRÜSÜ KAPISI — imzalı istek, amaç `bildir` (sıra protokol §4 ile aynı: kimlik → dizin → imza → nonce → hak).
// `esitle` kapısından (`installation-auth.ts`) üç farkı var, üçü de bilinçli:
//   ① dizin `lookupForBridge`: satıcı cevabı YAZILMAZ — yönlendirme bağı yok, tesis DB'si istenmez/açılmaz;
//   ② nonce MERKEZ tablosunda (`push_bridge_nonces`); ③ hak = LİSANS GEÇERLİ (aktif ∧ ETKIN ∧ devredilmemiş ∧
//      gönderici sınıf) — `patron-bulut` modülü ve abonelik bitişi ARANMAZ (kullanıcı kararı 2026-11-13).
import { CLOCK_SKEW_MS, UuidSchema, isCloudSenderClass, isoToMs, readRequestIdentity, verifyRequest, type RequestDoc } from "../lisans-protokol";
import { CloudError, requestRejected } from "../lib/errors";
import { isUniqueViolation } from "../lib/prisma-errors";
import { securityEvent } from "../lib/security-events";
import { withCentral } from "../lib/tenant";
import type { CloudContext } from "./context";
import { safeKeyId, type InstallationRecord } from "./installation-directory";

export interface BridgeCaller {
  readonly installationId: string;
  readonly record: InstallationRecord;
  readonly request: RequestDoc;
}

/** Lisans geçerli mi (köprü hakkı). `durum` yoksa (kayıt kipi / eski satıcı) aktiflik ve devir yeterlidir. */
export function bridgeEntitlementError(record: InstallationRecord, durum: string | undefined): CloudError | null {
  if (!record.active || record.handedOver || (durum !== undefined && durum !== "ETKIN")) {
    return new CloudError(403, "LISANS_GECERSIZ", "Bu kurulumun lisansı geçerli değil; anlık bildirim köprüsü kapalı");
  }
  if (!isCloudSenderClass(record.licenseClass)) {
    return new CloudError(403, "SINIF_GONDEREMEZ", "Bu kurulumun lisans sınıfı anlık bildirim gönderemez (yalnız üretim, barındırılan ve demo)");
  }
  return null;
}

async function recordBridgeNonce(ctx: CloudContext, installationId: string, request: RequestDoc, nowMs: number): Promise<void> {
  const expiresMs = Math.max(isoToMs(request.zaman), nowMs) + CLOCK_SKEW_MS;
  try {
    await withCentral(ctx.sync, {}, (tx) => tx.pushBridgeNonce.create({ data: { installationId, nonce: request.nonce, expiresAt: new Date(expiresMs) } }));
  } catch (err) {
    if (isUniqueViolation(err)) throw new CloudError(409, "ISTEK_TEKRAR", "Bu istek daha önce işlendi (tekrar oynatma)");
    throw err;
  }
}

export async function authenticateBridge(ctx: CloudContext, g: { header: unknown; rawBody: Buffer; nowMs: number; path: string }): Promise<BridgeCaller> {
  try {
    return await authenticate(ctx, g);
  } catch (err) {
    if (err instanceof CloudError && (err.status === 401 || err.status === 403)) securityEvent(err.status === 401 ? "IMZA_RED" : "HAK_RED", err.code);
    throw err;
  }
}

async function authenticate(ctx: CloudContext, g: { header: unknown; rawBody: Buffer; nowMs: number; path: string }): Promise<BridgeCaller> {
  if (typeof g.header !== "string" || g.header.length === 0) throw new CloudError(401, "ISTEK_GECERSIZ", "İmzalı istek başlığı (X-TKL-Istek) yok");
  const identity = readRequestIdentity(g.header);
  if (!identity.ok) throw requestRejected(identity.code, identity.message, g.nowMs);
  const installationId = identity.value.installationId;
  if (installationId === null || !UuidSchema.safeParse(installationId).success) throw new CloudError(401, "ISTEK_GECERSIZ", "İstekteki kurulum kimliği yok ya da biçimsiz");
  const found = await ctx.directory.lookupForBridge(installationId, g.nowMs);
  if (found.kind === "ulasilamadi") throw new CloudError(503, "TEKRAR_DENEYIN", "Kurulum kaydı şu an doğrulanamıyor; lütfen sonra tekrar deneyin");
  const record = found.kind === "ok" ? found.record : null;
  if (!record?.publicKeyX || safeKeyId(record.publicKeyX) !== identity.value.kid) {
    throw new CloudError(401, "KURULUM_BILINMIYOR", "Bu kurulum bu anahtarla patron bulutunda kayıtlı değil");
  }
  const verified = verifyRequest(g.header, { publicKeyX: record.publicKeyX, body: g.rawBody, nowMs: g.nowMs, purposes: ["bildir"], installationId, path: g.path });
  if (!verified.ok) throw requestRejected(verified.code, verified.message, g.nowMs);
  await recordBridgeNonce(ctx, installationId, verified.value, g.nowMs);
  const denied = bridgeEntitlementError(record, found.kind === "ok" ? found.durum : undefined);
  if (denied) throw denied;
  return { installationId, record, request: verified.value };
}
