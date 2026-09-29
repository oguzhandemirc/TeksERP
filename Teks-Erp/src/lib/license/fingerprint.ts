// Parmak izi ÖLÇÜMÜ: OS etkenleri (`fingerprint-os.ts`) + PostgreSQL (F5). Normalleştirme, tuzlu özet ve karar
// protokolde (`protocol/parmak-izi.ts`); burada yalnız ham değer okunur. Ham değer bu
// dosyadan dışarı yalnız `digestFingerprint`e gider — loga, audit'e, uca GİRMEZ.
import prisma from "../prisma";
import { collectOsFactors } from "./fingerprint-os";
import {
  FINGERPRINT_FACTORS,
  digestFingerprint,
  normalizeFactor,
  type Fingerprint,
  type FingerprintFactor,
  type RawFingerprint,
} from "./protocol";

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

/** Beş etkeni ölçer ve kurulum tuzuyla özetler. */
export async function measureFingerprint(salt: Uint8Array): Promise<MeasuredFingerprint> {
  const raw: RawFingerprint = { ...(await collectOsFactors()), f5: await postgresFactor() };
  const digest = digestFingerprint(raw, salt);
  const measured = Object.fromEntries(FINGERPRINT_FACTORS.map((f) => [f, digest[f] !== null])) as Record<FingerprintFactor, boolean>;
  return { digest, measured, measuredAt: new Date().toISOString() };
}
