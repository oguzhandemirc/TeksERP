// İMZA ANAHTARI SÜRESİ (K4) — kullanım başına (ALT · ara imzacı · İNDİRME) yüklü en yeni sertifikanın bitişine 30 /
// 15 / 7 / 1 gün kala `ANAHTAR_SURESI_BITIYOR` bildirimi: 30 gün kala tören günüdür. Tekillik anahtarı kid + eşik:
// aynı eşik ikinci satır doğurmaz. Tören atlanırsa sertifika bitince kira, HAK ve indirme belirteci basılamaz.
import { DAY_MS, isoToMs } from "../lisans-protokol";
import type { KeyStore } from "../keys/key-store";
import { lockKeySet } from "../lib/locks";
import { prisma } from "../lib/prisma";
import { enqueueNotificationTx } from "./outbox";

export const KEY_EXPIRY_WARNING_DAYS = [30, 15, 7, 1] as const;
export type ExpiringKeyUsage = "ALT" | "ARA" | "INDIRME";

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
 */
export function keyExpiryWarnings(keys: KeyStore, nowMs: number): KeyExpiryWarning[] {
  const latest = new Map<ExpiringKeyUsage, { kid: string; endMs: number }>();
  const consider = (usage: ExpiringKeyUsage, kid: string, endIso: string) => {
    const endMs = isoToMs(endIso);
    const cur = latest.get(usage);
    if (Number.isFinite(endMs) && (!cur || endMs > cur.endMs)) latest.set(usage, { kid, endMs });
  };
  for (const k of keys.subKeys) consider(k.kind, k.kid, k.document.bitis);
  for (const k of keys.intermediates) consider("ARA", k.kid, k.document.bitis);
  const out: KeyExpiryWarning[] = [];
  for (const [usage, { kid, endMs }] of latest) {
    const left = endMs - nowMs;
    if (left <= 0) continue;
    const passed = KEY_EXPIRY_WARNING_DAYS.filter((d) => left <= d * DAY_MS);
    if (passed.length > 0) out.push({ usage, kid, expiresAt: new Date(endMs), threshold: Math.min(...passed) });
  }
  return out;
}

const USAGE_LABEL: Readonly<Record<ExpiringKeyUsage, string>> = { ALT: "Kira (ALT)", ARA: "HAK ara imzacısı", INDIRME: "İndirme" };

/** Bakım işinden: uyarıları giden kutusuna yazar (anahtar kümesi kilidi altında; tekrar zararsız). Dönüş: yeni satır. */
export async function scanKeyExpiry(keys: KeyStore, nowMs: number): Promise<number> {
  const warnings = keyExpiryWarnings(keys, nowMs);
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
        referans: `${w.threshold} gün kala — dönem töreni (uretim-toren.mjs donem)`,
        tarih: w.expiresAt,
      });
    }
    return n;
  });
}
