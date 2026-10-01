// Bütünlük denetimi — PAKET anahtarıyla imzalı yük (`butunluk.jws`, `tekserp-butunluk`) + onun
// sha256'sıyla bağlı liste dosyası (`integrity-list.ts`). Bu TS uygulaması native çekirdeğin
// (`native/lisans-cekirdek/src/integrity.rs`) başvurusu ve geliştirme yoludur; üretimde denetim
// native'dedir (yamalı JS listeyi geçemesin). Karar sırası iki uygulamada aynıdır, kâhin ölçer.
import { createHash, type KeyObject } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DigestSchema,
  IsoTimeSchema,
  TYP,
  UuidSchema,
  VersionTextSchema,
  b64uEncode,
  decodeDocument,
  publicKeyFromX,
  verifyJws,
  type TrustAnchorMode,
} from "./protocol";
import {
  INTEGRITY_LIST_FILE,
  INTEGRITY_MAX_FILES,
  INTEGRITY_MAX_LIST_BYTES,
  byteOrder,
  parseIntegrityList,
  walkIntegrityScope,
  type IntegrityListEntry,
} from "./integrity-list";
import { BUILD_ANCHOR_MODE } from "./trust-anchor";

export const INTEGRITY_TYP = TYP.BUTUNLUK;
export { INTEGRITY_MAX_FILES };
/** Rapordaki dosya listelerinin tavanı (sayılar ayrıca tam verilir). */
export const INTEGRITY_LIST_CAP = 50;

export interface PackageKey {
  /** `paket-<yıl>` biçimi. */
  readonly kid: string;
  /** Ham 32 baytlık Ed25519 açık anahtarı, base64url. */
  readonly x: string;
}

/**
 * Üretim PAKET anahtarları (`paket-<yıl>[-<n>]`, parolalı tören) — native çekirdeğe GÖMÜLÜ çapanın (`anchor.rs`) kaynağı.
 * Satır yalnız `scripts/guven-capasi-ekle.ts paket` ile eklenir (`anchor.rs` ile birlikte), elle düzenlenmez.
 */
export const PRODUCTION_PACKAGE_PUBLIC_KEYS: readonly PackageKey[] = Object.freeze([
  Object.freeze({ kid: "paket-2026", x: "j7xjeBy3BGQu38IZrvaaJJFcQ0OJCp22z8fUNiYwaCM" }),
]);

/** Hazırlık PAKET anahtarları (`paket-hazirlik*`, parolasız) — yalnız hazırlık derlemesinde ve TEST/DEMO kurulumunda. */
export const STAGING_PACKAGE_PUBLIC_KEYS: readonly PackageKey[] = Object.freeze([
  Object.freeze({ kid: "paket-hazirlik", x: "auFAoNnXZDIWdyLJ5EVsakwMquIa_GHqCyKxZHz16Z8" }),
]);

const NO_PACKAGE_KEYS: readonly PackageKey[] = Object.freeze([]);

/** Kipin PAKET çapası; tanınmayan kip boş çapadır (fail-closed). */
export function packagePublicKeysFor(mode: TrustAnchorMode): readonly PackageKey[] {
  if (mode === "uretim") return PRODUCTION_PACKAGE_PUBLIC_KEYS;
  if (mode === "hazirlik") return STAGING_PACKAGE_PUBLIC_KEYS;
  return NO_PACKAGE_KEYS;
}

/** Bu derlemenin PAKET çapası (kip `trust-anchor.ts`): üretim derlemesi hazırlık anahtarıyla imzalı listeyi tanımaz. */
export const PACKAGE_PUBLIC_KEYS: readonly PackageKey[] = packagePublicKeysFor(BUILD_ANCHOR_MODE);

const PACKAGE_KID = /^paket-[a-z0-9-]{1,40}$/;
const SAFE_PATH = /^(?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_.@+-]+$/;

/** Göreli POSIX yol: `.`/`..` segmenti, ters eğik çizgi, sürücü harfi, baştaki `/` RED. */
const ManifestPathSchema = z
  .string()
  .max(512)
  .regex(SAFE_PATH)
  .refine((p) => p.split("/").every((s) => s !== "." && s !== ".."), "Yol `.`/`..` segmenti taşıyamaz");

const ScopeListSchema = (max: number) =>
  z
    .array(ManifestPathSchema)
    .max(max)
    .refine((list) => new Set(list).size === list.length, "Kapsamda tekrar var");

/** İmzalı yük: künye + liste dosyasının boyu/özeti/satır sayısı + FAZLA dosya aranacak kapsam. */
export const IntegrityManifestSchema = z.object({
  v: z.literal(1),
  paketId: UuidSchema,
  urun: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  surum: VersionTextSchema,
  derlemeTarihi: IsoTimeSchema,
  musteri: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).nullable(),
  liste: z.strictObject({
    sha256: DigestSchema,
    boyut: z.number().int().min(1).max(INTEGRITY_MAX_LIST_BYTES),
    dosyaSayisi: z.number().int().min(1).max(INTEGRITY_MAX_FILES),
  }),
  kapsam: z.strictObject({ dizinler: ScopeListSchema(32), dosyalar: ScopeListSchema(64) }),
});
export type IntegrityManifest = z.infer<typeof IntegrityManifestSchema>;

export type IntegrityVerdict = "GECERLI" | "GECERSIZ" | "OLCULEMEDI";

export interface IntegrityReport {
  readonly durum: IntegrityVerdict;
  /** GEÇERLİ'de null; aksi hâlde protokol kodu (`JWS_*`, `BELGE_*`) ya da `BUTUNLUK_*`. */
  readonly kod: string | null;
  readonly dosyaSayisi: number;
  readonly eksik: string[];
  readonly eksikSayisi: number;
  readonly degisik: string[];
  readonly degisikSayisi: number;
  readonly okunamayan: string[];
  readonly okunamayanSayisi: number;
  /** Kapsamda diskte duran ama listede olmayan girdiler (eklenmiş kod). */
  readonly fazla: string[];
  readonly fazlaSayisi: number;
  readonly paket: {
    readonly paketId: string;
    readonly urun: string;
    readonly surum: string;
    readonly derlemeTarihi: string;
    readonly musteri: string | null;
  } | null;
}

export const IntegrityReportSchema = z.object({
  durum: z.enum(["GECERLI", "GECERSIZ", "OLCULEMEDI"]),
  kod: z.string().nullable(),
  dosyaSayisi: z.number().int().min(0),
  eksik: z.array(z.string()),
  eksikSayisi: z.number().int().min(0),
  degisik: z.array(z.string()),
  degisikSayisi: z.number().int().min(0),
  okunamayan: z.array(z.string()),
  okunamayanSayisi: z.number().int().min(0),
  fazla: z.array(z.string()),
  fazlaSayisi: z.number().int().min(0),
  paket: z
    .object({ paketId: z.string(), urun: z.string(), surum: z.string(), derlemeTarihi: z.string(), musteri: z.string().nullable() })
    .nullable(),
});

interface Buckets {
  missing: string[];
  changed: string[];
  unreadable: string[];
  extra: string[];
}

const emptyBuckets = (): Buckets => ({ missing: [], changed: [], unreadable: [], extra: [] });

interface ReportInput {
  readonly durum: IntegrityVerdict;
  readonly kod: string | null;
  readonly total?: number;
  readonly buckets?: Buckets;
  readonly paket?: IntegrityReport["paket"];
}

function report({ durum, kod, total = 0, buckets, paket = null }: ReportInput): IntegrityReport {
  const cap = (list: string[]) => list.slice(0, INTEGRITY_LIST_CAP);
  const b = buckets ?? emptyBuckets();
  return {
    durum,
    kod,
    dosyaSayisi: total,
    eksik: cap(b.missing),
    eksikSayisi: b.missing.length,
    degisik: cap(b.changed),
    degisikSayisi: b.changed.length,
    okunamayan: cap(b.unreadable),
    okunamayanSayisi: b.unreadable.length,
    fazla: cap(b.extra),
    fazlaSayisi: b.extra.length,
    paket,
  };
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(b64uEncode(hash.digest())));
  });
}

function isNotFound(e: unknown): boolean {
  return e instanceof Error && "code" in e && (e.code === "ENOENT" || e.code === "ENOTDIR");
}

async function checkFile(root: string, f: IntegrityListEntry, out: Buckets): Promise<void> {
  const full = path.join(root, ...f.yol.split("/"));
  let info;
  try {
    info = await stat(full);
  } catch (e) {
    if (isNotFound(e)) out.missing.push(f.yol);
    else out.unreadable.push(f.yol);
    return;
  }
  if (!info.isFile()) return void out.missing.push(f.yol);
  if (info.size !== f.boyut) return void out.changed.push(f.yol);
  try {
    if ((await sha256File(full)) !== f.sha256) out.changed.push(f.yol);
  } catch {
    out.unreadable.push(f.yol);
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export type ListRead =
  | { readonly ok: true; readonly entries: IntegrityListEntry[] }
  | { readonly ok: false; readonly bucket: "missing" | "changed" | "unreadable" };

/** Liste dosyası: yok → eksik · boy/özet/dilbilgisi tutmaz → değişik · okunamaz → okunamayan. */
export async function readIntegrityList(root: string, liste: IntegrityManifest["liste"]): Promise<ListRead> {
  const file = path.join(root, INTEGRITY_LIST_FILE);
  let bytes: Buffer;
  try {
    const info = await stat(file);
    if (!info.isFile()) return { ok: false, bucket: "missing" };
    if (info.size !== liste.boyut) return { ok: false, bucket: "changed" };
    bytes = await readFile(file);
  } catch (e) {
    return { ok: false, bucket: isNotFound(e) ? "missing" : "unreadable" };
  }
  if (bytes.length !== liste.boyut || b64uEncode(createHash("sha256").update(bytes).digest()) !== liste.sha256) {
    return { ok: false, bucket: "changed" };
  }
  const entries = parseIntegrityList(bytes, liste.dosyaSayisi);
  return entries ? { ok: true, entries } : { ok: false, bucket: "changed" };
}

export type SignedManifest =
  | { readonly ok: true; readonly kid: string; readonly manifest: IntegrityManifest }
  | { readonly ok: false; readonly durum: "GECERSIZ" | "OLCULEMEDI"; readonly code: string };

/**
 * İmzalı yükü verilen PAKET çapasıyla doğrular ve çözer — TS çekirdeği, `.node` yükleyicisi ve ikinci katman AYNI
 * kuralı kullanır (biçimsiz çapa ölçülemedi; imza/şema düşerse geçersiz).
 */
export function verifySignedManifest(manifest: unknown, keys: readonly PackageKey[]): SignedManifest {
  const usable = new Map<string, KeyObject>();
  for (const k of keys) {
    const key = PACKAGE_KID.test(k.kid) ? publicKeyFromX(k.x) : null;
    if (key) usable.set(k.kid, key);
  }
  if (usable.size === 0 || usable.size !== keys.length) return { ok: false, durum: "OLCULEMEDI", code: "BUTUNLUK_CAPA_BOS" };
  const j = verifyJws(manifest, { typ: INTEGRITY_TYP, findKey: (kid) => usable.get(kid) });
  if (!j.ok) return { ok: false, durum: "GECERSIZ", code: j.code };
  const d = decodeDocument(IntegrityManifestSchema, j.value.payload);
  if (!d.ok) return { ok: false, durum: "GECERSIZ", code: d.code };
  return { ok: true, kid: j.value.header.kid, manifest: d.value };
}

/** İmzalı yüke karşı `root` altındaki dosyalar. `keys` verilmezse bu derlemenin `PACKAGE_PUBLIC_KEYS`i. */
export async function verifyIntegrity(manifest: unknown, root: string, keys: readonly PackageKey[] = PACKAGE_PUBLIC_KEYS): Promise<IntegrityReport> {
  const signed = verifySignedManifest(manifest, keys);
  if (!signed.ok) return report({ durum: signed.durum, kod: signed.code });
  const m = signed.manifest;
  const paket = { paketId: m.paketId, urun: m.urun, surum: m.surum, derlemeTarihi: m.derlemeTarihi, musteri: m.musteri };
  const total = m.liste.dosyaSayisi;
  if (!(await isDirectory(root))) return report({ durum: "OLCULEMEDI", kod: "BUTUNLUK_OKUNAMADI", total, paket });
  const buckets = emptyBuckets();
  const list = await readIntegrityList(root, m.liste);
  if (!list.ok) {
    buckets[list.bucket].push(INTEGRITY_LIST_FILE);
    const bad = list.bucket !== "unreadable";
    return report({ durum: bad ? "GECERSIZ" : "OLCULEMEDI", kod: bad ? "BUTUNLUK_LISTE_BOZUK" : "BUTUNLUK_OKUNAMADI", total, buckets, paket });
  }
  for (const f of list.entries) await checkFile(root, f, buckets);
  const expectedPaths = new Set(list.entries.map((f) => f.yol));
  const walk = await walkIntegrityScope(root, m.kapsam);
  buckets.extra = walk.entries.filter((e) => !expectedPaths.has(e));
  buckets.unreadable = [...buckets.unreadable, ...walk.unreadable].sort(byteOrder);
  if (buckets.missing.length > 0 || buckets.changed.length > 0) return report({ durum: "GECERSIZ", kod: "BUTUNLUK_UYUSMAZ", total, buckets, paket });
  if (buckets.extra.length > 0) return report({ durum: "GECERSIZ", kod: "BUTUNLUK_FAZLA", total, buckets, paket });
  if (buckets.unreadable.length > 0) return report({ durum: "OLCULEMEDI", kod: "BUTUNLUK_OKUNAMADI", total, buckets, paket });
  return report({ durum: "GECERLI", kod: null, total, buckets, paket });
}
