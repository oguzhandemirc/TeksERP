// PostgreSQL PAKETİ ve backend'in PG GEREKSİNİMİ (Dağıtım v2, sözleşme sürümü 2 — docs/design/GUNCELLEYICI.md §1.6;
// şartname KENDI-POSTGRESQL.md, D4). PG paketi kanalda backend paketinden AYRI durur (`/<kanal>/backend/pg/
// <sürüm>-<derleme>/`), kendi PAKET imzalı künyesiyle (`tekserp-pg`); backend bildirimi hedefi künyeyle BAĞLANIR.
// Ana sürüm (çizgi) değişimi hiçbir yoldan otomatik değildir.
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { IsoTimeSchema, PROTOCOL_VERSION, TYP, decodeDocument, signDocument } from "./belgeler";
import { ArtifactSchema, Sha256HexSchema, UPDATE_PLATFORMS, isPackageKid, type PackagePublicKey } from "./guncelleme-ortak";
import { verifyPackageSigned, type PackageTrust } from "./paket-zinciri";
import { failure, forwardFailure, success, type Result } from "./ortak";

/** `/<kanal>/backend/pg/<sürüm>-<derleme>/` — dizin değişmez; künye `pg.json`, paket künyedeki `paket.ad`. */
export const PG_RELEASE_DIR = "pg";
export const PG_POINTER_FILE = "pg.json";

/** PostgreSQL `ana.küçük` (`16.15`). */
export const PgVersionSchema = z.string().regex(/^[0-9]{2}\.[0-9]{1,3}$/);
/** Ana sürüm (çizgi) — `PG_VERSION` dosyasının değeri. */
export const PgMajorSchema = z.number().int().min(10).max(99);
/** EDB derlemesi (`16.15-4`teki 4). */
export const PgBuildSchema = z.number().int().min(1).max(999);
/** ICU ana sürümü (`icuuc67.dll` → `67`). */
export const IcuVersionSchema = z.string().regex(/^[0-9]{2,3}$/);

export function pgMajor(surum: string): number {
  return Number(surum.split(".")[0]);
}

/** Kurulu ya da hedef PG: sürüm + (biliniyorsa) derleme. */
export interface PgBuildRef {
  readonly surum: string;
  readonly derleme: number | null;
}

/** −1 · 0 · 1 (ana · küçük · derleme sayısal; derleme bilinmiyorsa 0 sayılır); biçimsiz sürümde null. */
export function comparePgVersions(a: PgBuildRef, b: PgBuildRef): -1 | 0 | 1 | null {
  if (!PgVersionSchema.safeParse(a.surum).success || !PgVersionSchema.safeParse(b.surum).success) return null;
  const x = [...a.surum.split(".").map(Number), a.derleme ?? 0];
  const y = [...b.surum.split(".").map(Number), b.derleme ?? 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Kendi örnekte hedef PG — PG künyesinin bağlanan alanları (backend bildirimi taşır). */
export const PgTargetSchema = z.object({
  surum: PgVersionSchema,
  derleme: PgBuildSchema,
  paket: ArtifactSchema,
  /** Paketteki içerik manifestosunun (`TEKSERP-ICERIK.sha256`) sha256'sı — açılan her dosya ona karşı ölçülür. */
  icerikSha256: Sha256HexSchema,
  icuSurum: IcuVersionSchema,
});
export type PgTarget = z.infer<typeof PgTargetSchema>;

/**
 * Backend sürümünün PG gereksinimi: TEK ana sürüm (`cizgi`) + desteklenen en eski küçük sürüm (`enAz`, harici kip
 * yalnız bunu denetler) + kendi örnek için hedef (`hedef`, yoksa küçük sürüm güncellemesi yok). Aralık = [enAz, cizgi.*].
 */
export const PgRequirementSchema = z
  .object({ cizgi: PgMajorSchema, enAz: PgVersionSchema, hedef: PgTargetSchema.nullable() })
  .refine((p) => pgMajor(p.enAz) === p.cizgi, { message: "enAz çizginin ana sürümünde olmalı" })
  .refine((p) => p.hedef === null || pgMajor(p.hedef.surum) === p.cizgi, { message: "Hedef PG çizginin ana sürümünde olmalı" })
  .refine((p) => p.hedef === null || (comparePgVersions(p.hedef, { surum: p.enAz, derleme: null }) ?? -1) >= 0, {
    message: "Hedef PG enAz'dan eski olamaz",
  });
export type PgRequirement = z.infer<typeof PgRequirementSchema>;

export const PG_PRODUCT = "postgresql";

/** PG paketi künyesi (`tekserp-pg`, PAKET imzalı) — kanaldan bağımsız: aynı ikili her kanalda aynıdır. */
export const PgPackageManifestSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    urun: z.literal(PG_PRODUCT),
    platform: z.enum(UPDATE_PLATFORMS),
    cizgi: PgMajorSchema,
    surum: PgVersionSchema,
    derleme: PgBuildSchema,
    paket: ArtifactSchema,
    icerikSha256: Sha256HexSchema,
    icuSurum: IcuVersionSchema,
    yayinZamani: IsoTimeSchema,
  })
  .refine((k) => pgMajor(k.surum) === k.cizgi, { message: "PG sürümü çizginin ana sürümünde olmalı" });
export type PgPackageManifest = z.infer<typeof PgPackageManifestSchema>;

export function pgReleaseFilePath(kanal: string, surum: string, derleme: number, dosya: string): string {
  return `/${kanal}/backend/${PG_RELEASE_DIR}/${surum}-${derleme}/${dosya}`;
}

export function signPgPackageManifest(g: {
  readonly payload: PgPackageManifest;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
}): string {
  if (!isPackageKid(g.key.kid)) throw new Error("signPgPackageManifest: kid paket- ile başlamalı");
  return signDocument({ typ: TYP.PG, schema: PgPackageManifestSchema, payload: g.payload, key: g.key });
}

/** Sıra: JWS (typ · kid · imza; `pkt-*` ise zincir) → şema. Anahtar kümesi çağıranın (hazırlık anahtarı yalnız TEST/DEMO'da). */
export function verifyPgPackageManifest(
  token: unknown,
  g: { readonly keys: readonly PackagePublicKey[]; readonly zincir?: Omit<PackageTrust, "keys"> },
): Result<PgPackageManifest> {
  const j = verifyPackageSigned(token, TYP.PG, { roots: [], mode: "YERLESIK", ...g.zincir, keys: g.keys });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(PgPackageManifestSchema, j.value.payload);
  return b.ok ? success(b.value) : forwardFailure(b);
}

/**
 * Backend bildiriminin PG hedefi bu künyenin paketi mi? Çizgi (ANA SÜRÜM) · sürüm · derleme · paket (ad, boy, özet) ·
 * içerik özeti · ICU birebir; hedef yoksa bağ yok (`PG_BAGI`). Farklı ana sürümlü paket burada düşer.
 */
export function checkPgBinding(req: PgRequirement, k: PgPackageManifest): Result<true> {
  const h = req.hedef;
  if (h === null) return failure("PG_BAGI", "Backend bildirimi PG hedefi taşımıyor");
  const off: string[] = [];
  if (k.cizgi !== req.cizgi) off.push("cizgi");
  if (k.surum !== h.surum) off.push("surum");
  if (k.derleme !== h.derleme) off.push("derleme");
  if (k.paket.ad !== h.paket.ad || k.paket.boyut !== h.paket.boyut || k.paket.sha256 !== h.paket.sha256) off.push("paket");
  if (k.icerikSha256 !== h.icerikSha256) off.push("icerikSha256");
  if (k.icuSurum !== h.icuSurum) off.push("icuSurum");
  return off.length === 0 ? success(true) : failure("PG_BAGI", `PG künyesi bildirimin hedefiyle bağlanmıyor: ${off.join(", ")}`);
}
