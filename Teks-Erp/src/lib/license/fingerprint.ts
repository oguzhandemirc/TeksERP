// Parmak izi ÖLÇÜMÜ: OS etkenleri (f1..f4) ve tuzlu özet LİSANS ÇEKİRDEĞİNDE (üretimde native),
// PostgreSQL etkeni (F5) burada okunur. Ham F5 bu dosyadan dışarı yalnız çekirdeğe gider —
// loga, audit'e, uca GİRMEZ.
import prisma from "../prisma";
import { normalizeFactor, type Fingerprint, type FingerprintFactor } from "./protocol";
import type { LicenseCore } from "./license-core";
import { getLicenseCore } from "./native";

export interface MeasuredFingerprint {
  readonly digest: Fingerprint;
  /** Etken ölçülebildi mi — ekran bunu gösterir (değerin kendisini değil). */
  readonly measured: Readonly<Record<FingerprintFactor, boolean>>;
  readonly measuredAt: string;
}

/** F5: kümenin kimliği. Rol yetkisi yoksa ya da sorgu düşerse ölçülemedi. */
async function postgresFactor(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string | null }>>`SELECT system_identifier::text AS id FROM pg_control_system()`;
    const id = rows[0]?.id;
    return typeof id === "string" && normalizeFactor("f5", id) !== null ? id : null;
  } catch {
    return null;
  }
}

/** Beş etkeni ölçer ve kurulum tuzuyla özetler (çekirdek kullanılamıyorsa hepsi ölçülemedi). */
export async function measureFingerprint(salt: Uint8Array, core: LicenseCore = getLicenseCore()): Promise<MeasuredFingerprint> {
  const c = await core.collectFingerprint(salt, await postgresFactor());
  return { digest: c.digest, measured: c.measured, measuredAt: new Date().toISOString() };
}
