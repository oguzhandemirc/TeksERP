// İMZA ANAHTARI SÜRESİ (K4) — kullanım başına (ALT · ara imzacı · İNDİRME · ISTEMCI · PAKET) yüklü en yeni sertifikanın
// bitişine 30 / 15 / 7 / 1 gün kala `ANAHTAR_SURESI_BITIYOR` bildirimi: 30 gün kala tören günüdür. Tekillik anahtarı
// kid + eşik: aynı eşik ikinci satır doğurmaz. Tören atlanırsa sertifika bitince kira, HAK ve indirme belirteci; ISTEMCI
// (bağlı OTA yaprağı dahil — erken biteni sayılır) ve PAKET için yeni sürüm imzası basılamaz.
import { DAY_MS, isPackageCertificateRevoked, isoToMs, msToIso, type VerifiedPackageRevocation } from "../lisans-protokol";
import type { KeyStore } from "../keys/key-store";
import { lockKeySet } from "../lib/locks";
import { prisma } from "../lib/prisma";
import { newestPackageRevocation } from "../services/package-revocation.service";
import { enqueueNotificationTx } from "./outbox";

export const KEY_EXPIRY_WARNING_DAYS = [30, 15, 7, 1] as const;
export type ExpiringKeyUsage = "ALT" | "ARA" | "INDIRME" | "ISTEMCI" | "PAKET";

export interface KeyExpiryWarning {
  readonly usage: ExpiringKeyUsage;
  readonly kid: string;
  readonly expiresAt: Date;
  /** Geçilen en küçük eşik (gün). */
  readonly threshold: number;
}

/**
 * SAF: kullanım başına en geç biten yüklü sertifika; bitişine kalan süre bir eşiğin altındaysa uyarı. Süresi dolmuş
 * sertifika uyarı değil (1 gün eşiği zaten yazıldı); o kullanımda hiç anahtar yoksa uyarı da yok (künye uyarısı ayrı).
 * Dağıtım iptalindeki (kid ya da sertifika kimliği) açık sertifika hesaba girmez.
 */
export function keyExpiryWarnings(keys: KeyStore, nowMs: number, revocation: VerifiedPackageRevocation | null = null): KeyExpiryWarning[] {
  const latest = new Map<ExpiringKeyUsage, { kid: string; endMs: number }>();
  const consider = (usage: ExpiringKeyUsage, kid: string, endIso: string) => {
    const endMs = isoToMs(endIso);
    const cur = latest.get(usage);
    if (Number.isFinite(endMs) && (!cur || endMs > cur.endMs)) latest.set(usage, { kid, endMs });
  };
  for (const k of keys.subKeys) consider(k.kind, k.kid, k.document.bitis);
  for (const k of keys.intermediates) consider("ARA", k.kid, k.document.bitis);
  // İptal edilmiş ISTEMCI/PAKET artık imzalamaz; süresi tören takvimini belirlemez.
  for (const c of keys.openCertificates.filter((x) => !isPackageCertificateRevoked(x.document, revocation))) {
    // OTA yaprağı toleranssızdır: ISTEMCI'nin bitişi, kendisi ile bağlı yaprağının ERKEN biteni.
    const leafEnds = keys.otaLeaves.filter((l) => l.clientKid === c.kid).map((l) => l.notAfter.getTime());
    consider(c.usage, c.kid, msToIso(Math.min(isoToMs(c.document.bitis), ...leafEnds)));
  }
  const out: KeyExpiryWarning[] = [];
  for (const [usage, { kid, endMs }] of latest) {
    const left = endMs - nowMs;
    if (left <= 0) continue;
    const passed = KEY_EXPIRY_WARNING_DAYS.filter((d) => left <= d * DAY_MS);
    if (passed.length > 0) out.push({ usage, kid, expiresAt: new Date(endMs), threshold: Math.min(...passed) });
  }
  return out;
}

const USAGE_LABEL: Readonly<Record<ExpiringKeyUsage, string>> = {
  ALT: "Kira (ALT)",
  ARA: "HAK ara imzacısı",
  INDIRME: "İndirme",
  ISTEMCI: "Panel/tablet güncelleme imzası (ISTEMCI)",
  PAKET: "Paket imzası (PAKET)",
};

/** Bakım işinden: uyarıları giden kutusuna yazar (anahtar kümesi kilidi altında; tekrar zararsız). Dönüş: yeni satır. */
export async function scanKeyExpiry(keys: KeyStore, nowMs: number): Promise<number> {
  const warnings = keyExpiryWarnings(keys, nowMs, (await newestPackageRevocation(prisma, keys))?.verified ?? null);
  if (warnings.length === 0) return 0;
  return prisma.$transaction(async (tx) => {
    await lockKeySet(tx);
    let n = 0;
    for (const w of warnings) {
      n += await enqueueNotificationTx(tx, {
        event: "ANAHTAR_SURESI_BITIYOR",
        keyParts: [w.kid, w.threshold],
        installationDbId: null,
        portalPath: "/anahtarlar",
        konu: `${USAGE_LABEL[w.usage]} · ${w.kid}`,
        referans: `${w.threshold} gün kala — dönem töreni (uretim-toren.mjs donem${w.usage === "ISTEMCI" ? " --istemci" : ""})`,
        tarih: w.expiresAt,
      });
    }
    return n;
  });
}
