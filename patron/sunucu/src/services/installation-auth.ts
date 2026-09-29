// FABRİKA KANALI KAPISI — imzalı İSTEK (protokol LISANS-PROTOKOLU.md §4 sırası, amaç `esitle`):
//   ① readRequestIdentity (imzasız) → kurulum dizini (açık anahtar + hak) ② verifyRequest (typ ·
//   imza · kurulum · amaç · ±10 dk · HAM gövde özeti) ③ nonce ATOMİK (tesis kapsamında UNIQUE) ④ hak
//   kapısı: yalnız URETIM sınıfı + `patron-bulut` modülü + bitmemiş abonelik + DEVREDİLMEMİŞ.
// Kiracı İSTEKTEN değil kurulumdan çözülür (`tesisId` gövdeden ALINMAZ — sözleşme §9.2).
import { CLOCK_SKEW_MS, UuidSchema, isoToMs, readRequestIdentity, verifyRequest, type RequestDoc } from "../lisans-protokol";
import { CloudError, requestRejected } from "../lib/errors";
import { isUniqueViolation } from "../lib/prisma-errors";
import { withTesis } from "../lib/tenant";
import type { CloudContext } from "./context";
import { safeKeyId, type InstallationRecord } from "./installation-directory";

export const CLOUD_MODULE_KEY = "patron-bulut";

export interface FactoryCaller {
  readonly installation: InstallationRecord;
  readonly tesisId: string;
  readonly request: RequestDoc;
}

/** Eşitleme hakkı (sözleşme §1.4 — bulut İKİNCİ kapıdır; fabrika zaten göndermez). */
export function cloudEntitlementError(inst: InstallationRecord, nowMs: number): CloudError | null {
  if (inst.licenseClass !== "URETIM") {
    return new CloudError(403, "SINIF_GONDEREMEZ", "Bu kurulumun lisans sınıfı patron bulutuna veri gönderemez (yalnız üretim)");
  }
  const until = inst.cloudUntil?.getTime() ?? 0;
  if (!inst.modules.includes(CLOUD_MODULE_KEY) || until <= nowMs || inst.handedOver) {
    return new CloudError(403, "PATRON_BULUT_KAPALI", "Patron bulutu hakkı yok ya da aboneliğin süresi doldu");
  }
  return null;
}

async function recordNonce(ctx: CloudContext, inst: InstallationRecord, request: RequestDoc, nowMs: number): Promise<void> {
  const expiresMs = Math.max(isoToMs(request.zaman), nowMs) + CLOCK_SKEW_MS;
  try {
    await withTesis(ctx.sync, { tesisId: inst.tesisId }, (tx) =>
      tx.requestNonce.create({
        data: { tesisId: inst.tesisId, installationId: inst.installationId, nonce: request.nonce, expiresAt: new Date(expiresMs) },
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new CloudError(409, "ISTEK_TEKRAR", "Bu istek daha önce işlendi (tekrar oynatma)");
    throw err;
  }
}

export async function authenticateFactory(ctx: CloudContext, g: { header: unknown; rawBody: Buffer; nowMs: number }): Promise<FactoryCaller> {
  if (typeof g.header !== "string" || g.header.length === 0) {
    throw new CloudError(401, "ISTEK_GECERSIZ", "İmzalı istek başlığı (X-TKL-Istek) yok");
  }
  const identity = readRequestIdentity(g.header);
  if (!identity.ok) throw requestRejected(identity.code, identity.message);
  // Kimliksiz istek (protokolde yalnız etkinleştirme/taşıma) bulut kanalında meşru değil: `esitle` kimlik taşır.
  const installationId = identity.value.installationId;
  if (installationId === null || !UuidSchema.safeParse(installationId).success) {
    throw new CloudError(401, "ISTEK_GECERSIZ", "İstekteki kurulum kimliği yok ya da biçimsiz");
  }
  const inst = await ctx.directory.resolve(installationId, g.nowMs);
  if (!inst || !inst.publicKeyX) throw new CloudError(401, "KURULUM_BILINMIYOR", "Bu kurulum patron bulutunda kayıtlı değil");
  if (safeKeyId(inst.publicKeyX) !== identity.value.kid) {
    throw new CloudError(401, "ISTEK_KID", "İstek bu kurulumun kayıtlı anahtarıyla imzalanmamış");
  }
  const verified = verifyRequest(g.header, {
    publicKeyX: inst.publicKeyX,
    body: g.rawBody,
    nowMs: g.nowMs,
    purposes: ["esitle"],
    installationId,
  });
  if (!verified.ok) throw requestRejected(verified.code, verified.message);
  await recordNonce(ctx, inst, verified.value, g.nowMs);
  if (!inst.active) throw new CloudError(403, "KURULUM_IPTAL", "Bu kurulumun kaydı pasif; patron bulutu kanalı kapalı");
  const denied = cloudEntitlementError(inst, g.nowMs);
  if (denied) throw denied;
  return { installation: inst, tesisId: inst.tesisId, request: verified.value };
}
