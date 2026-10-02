// Güncelleme sözleşmesinin ORTAK ilkelleri (Dağıtım v2 — docs/design/GUNCELLEYICI.md §1): paket dosyası künyesi,
// PAKET anahtar kümesi ve imzalı işaretçi. Backend bildirimi (`guncelleme.ts`) ile PostgreSQL paketi künyesi
// (`guncelleme-pg.ts`) aynı ilkelleri kullanır.
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { publicKeyFromX } from "./jws";
import { JwsTextSchema, PROTOCOL_VERSION } from "./belgeler";
import { failure, isPlainObject, success, type Result } from "./ortak";

export const UPDATE_PLATFORMS = ["win32-x64"] as const;
export const PACKAGE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const POINTER_MAX_BYTES = 64 * 1024;
const PACKAGE_KID = /^paket-[a-z0-9-]{1,40}$/;

export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ArtifactNameSchema = z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.zip$/);
export const PackageKidSchema = z.string().regex(PACKAGE_KID);

/** Kanalda duran bir zip'in künyesi: sürüm dizinindeki ad (yol yok), bayt boyu, zip baytlarının sha256'sı. */
export const ArtifactSchema = z.object({
  ad: ArtifactNameSchema,
  boyut: z.number().int().min(1).max(PACKAGE_MAX_BYTES),
  sha256: Sha256HexSchema,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export interface PackagePublicKey {
  readonly kid: string;
  readonly x: string;
}

/** Çağıranın süzdüğü PAKET açık anahtarları → kid eşlemi (biçimsiz kid/anahtar sessizce dışarıda). */
export function packageKeyLookup(keys: readonly PackagePublicKey[]): ReadonlyMap<string, KeyObject> {
  const lookup = new Map<string, KeyObject>();
  for (const k of keys) {
    const keyObj = PACKAGE_KID.test(k.kid) ? publicKeyFromX(k.x) : null;
    if (keyObj) lookup.set(k.kid, keyObj);
  }
  return lookup;
}

export function isPackageKid(kid: string): boolean {
  return PACKAGE_KID.test(kid);
}

/** İşaretçi (`son.json` · `<sürüm>/surum.json` · `pg/<sürüm>-<derleme>/pg.json`): yalnız imzalı `bildirim`e güvenilir. */
export const ReleasePointerSchema = z.strictObject({ v: z.literal(PROTOCOL_VERSION), bildirim: JwsTextSchema });

export function releasePointerText(token: string): string {
  return `${JSON.stringify(ReleasePointerSchema.parse({ v: PROTOCOL_VERSION, bildirim: token }))}\n`;
}

export function readReleasePointer(text: string): Result<string> {
  if (text.length > POINTER_MAX_BYTES) return failure("SURUM_ISARETCI", "Sürüm işaretçisi çok büyük");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return failure("SURUM_ISARETCI", "Sürüm işaretçisi JSON değil");
  }
  if (isPlainObject(raw) && raw.v !== PROTOCOL_VERSION) return failure("BELGE_SURUM", `Desteklenmeyen işaretçi sürümü: ${String(raw.v)}`);
  const p = ReleasePointerSchema.safeParse(raw);
  return p.success ? success(p.data.bildirim) : failure("SURUM_ISARETCI", "Sürüm işaretçisi biçimsiz");
}
