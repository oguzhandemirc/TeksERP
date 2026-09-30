// Backend güncelleme sözleşmesi (Dağıtım v2 — anlatım docs/design/GUNCELLEYICI.md §1–§3): SÜRÜM BİLDİRİMİ
// (`tekserp-surum`, PAKET imzalı) · işaretçi · paket bağı · sürüm karşılaştırma · yoklamadaki güncelleme
// raporu. Politika/pencere/karar `guncelleme-karar.ts`te. Güncelleyici (Rust) test vektörleriyle
// (`Teks-Erp/native/test-vektorleri/guncelleme-*.json`) aynalar.
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { publicKeyFromX, verifyJws } from "./jws";
import {
  ChannelCodeSchema,
  IsoTimeSchema,
  JwsTextSchema,
  PROTOCOL_VERSION,
  ReleaseVersionSchema,
  TYP,
  TimeZoneNameSchema,
  UuidSchema,
  VersionTextSchema,
  decodeDocument,
  signDocument,
  type DownloadProduct,
} from "./belgeler";
import { CLOCK_SKEW_MS, failure, forwardFailure, isPlainObject, isoToMs, success, type Result } from "./ortak";

// ── Yayın düzeni ──────────────────────────────────────────────────────────────
export const RELEASE_PRODUCT_DIR: DownloadProduct = "backend";
export const UPDATE_PRODUCTS = ["backend"] as const;
export const UPDATE_PLATFORMS = ["win32-x64"] as const;
/** Kanalın en yeni sürümü: `/<kanal>/backend/son.json` — yayında EN SON yüklenir. */
export const RELEASE_POINTER_FILE = "son.json";
/** Sürüm dizinindeki DEĞİŞMEZ işaretçi: `/<kanal>/backend/<sürüm>/surum.json` (sabitlemede okunur). */
export const RELEASE_MANIFEST_FILE = "surum.json";
export const PACKAGE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const POINTER_MAX_BYTES = 64 * 1024;
const PACKAGE_KID = /^paket-[a-z0-9-]{1,40}$/;

export function releasePointerPath(kanal: string): string {
  return `/${kanal}/${RELEASE_PRODUCT_DIR}/${RELEASE_POINTER_FILE}`;
}

export function releaseFilePath(kanal: string, surum: string, dosya: string): string {
  return `/${kanal}/${RELEASE_PRODUCT_DIR}/${surum}/${dosya}`;
}

// ── Sürüm bildirimi (`tekserp-surum`) ────────────────────────────────────────
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ArtifactNameSchema = z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.zip$/);
export const PackageKidSchema = z.string().regex(PACKAGE_KID);
/** PostgreSQL `ana.küçük` (`16.4`). */
export const PgVersionSchema = z.string().regex(/^[0-9]{2}\.[0-9]{1,3}$/);
const NodeVersionSchema = z.string().regex(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/);

const ArtifactSchema = z.object({
  ad: ArtifactNameSchema,
  boyut: z.number().int().min(1).max(PACKAGE_MAX_BYTES),
  sha256: Sha256HexSchema,
});

export const ReleaseManifestSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    urun: z.enum(UPDATE_PRODUCTS),
    platform: z.enum(UPDATE_PLATFORMS),
    kanal: ChannelCodeSchema,
    surum: ReleaseVersionSchema,
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    /** Paketin imzalı künyesiyle (`butunluk.jws`) aynı; bakım sonu denetimi bunu HAK `bakimBitis`iyle kıyaslar. */
    derlemeTarihi: IsoTimeSchema,
    yayinZamani: IsoTimeSchema,
    /** Paket zip'i: sürüm dizininde `ad`; `paketId` açılan paketin künyesindekiyle aynı olmalı. */
    paket: ArtifactSchema.extend({ paketId: UuidSchema }),
    /** Paketin dosya listesini imzalayan PAKET anahtarı = bu bildirimi imzalayan anahtar. */
    paketImzaKid: PackageKidSchema,
    /** Doğrudan geçişin en eski kaynak sürümü; daha eski kurulum önce ara sürüme sabitlenir. null = sınır yok. */
    minKaynakSurum: ReleaseVersionSchema.nullable(),
    gocSayisi: z.number().int().min(0).max(100_000),
    /** `paket` varsa küçük sürüm güncellemesi bu zip'le yapılır; ana sürüm geçişi otomatik DEĞİLDİR. */
    pg: z.object({ gerekenSurum: PgVersionSchema, paket: ArtifactSchema.nullable() }),
    /** Paketin kendi taşıdığı Node (`runtime/node.exe`) — bilgi. */
    runtime: z.object({ node: NodeVersionSchema }),
    notlar: z.object({ ozet: z.string().min(1).max(2000) }),
    /** Gösterim içindir (panel/filo "kritik"); zamanlamayı politikadan başka hiçbir şey belirlemez. */
    zorunlu: z.boolean(),
  })
  .refine((m) => m.minKaynakSurum === null || (compareVersions(m.minKaynakSurum, m.surum) ?? 0) < 0, {
    message: "minKaynakSurum sürümün kendisinden eski olmalı",
  })
  .refine((m) => isoToMs(m.derlemeTarihi) <= isoToMs(m.yayinZamani) + CLOCK_SKEW_MS, {
    message: "Derleme tarihi yayın zamanından sonra olamaz",
  });
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

/** `son.json` ve `<sürüm>/surum.json` aynı biçimdedir; yalnız imzalı `bildirim`e güvenilir. */
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

export interface PackagePublicKey {
  readonly kid: string;
  readonly x: string;
}

export function signReleaseManifest(g: {
  readonly payload: ReleaseManifest;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
}): string {
  if (!PACKAGE_KID.test(g.key.kid)) throw new Error("signReleaseManifest: kid paket- ile başlamalı");
  if (g.payload.paketImzaKid !== g.key.kid) throw new Error("signReleaseManifest: paketImzaKid imzalayan anahtar olmalı");
  return signDocument({ typ: TYP.SURUM, schema: ReleaseManifestSchema, payload: g.payload, key: g.key });
}

/**
 * Sıra (Rust aynası aynı sırayla aynı kodu verir): JWS (typ · kid · imza) → şema → imzalayan = `paketImzaKid`
 * → kanal. `keys` ÇAĞIRANIN süzdüğü kümedir: hazırlık anahtarını yalnız TEST/DEMO kurulumu verir.
 */
export function verifyReleaseManifest(
  token: unknown,
  g: { readonly keys: readonly PackagePublicKey[]; readonly kanal: string },
): Result<ReleaseManifest> {
  const lookup = new Map<string, KeyObject>();
  for (const k of g.keys) {
    const keyObj = PACKAGE_KID.test(k.kid) ? publicKeyFromX(k.x) : null;
    if (keyObj) lookup.set(k.kid, keyObj);
  }
  const j = verifyJws(token, { typ: TYP.SURUM, findKey: (kid) => lookup.get(kid) });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(ReleaseManifestSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  if (j.value.header.kid !== b.value.paketImzaKid) return failure("SURUM_ANAHTAR", "Bildirimi imzalayan anahtar paketImzaKid değil");
  if (b.value.kanal !== g.kanal) return failure("SURUM_KANAL", `Bildirim ${b.value.kanal} kanalının, kurulum ${g.kanal} kanalında`);
  return success(b.value);
}

/** Açılan paketin imzalı künyesinden (`butunluk.jws` + imzalayan kid) bildirime bağ için gereken alanlar. */
export interface PackageIdentity {
  readonly kid: string;
  readonly paketId: string;
  readonly urun: string;
  readonly surum: string;
  readonly derlemeTarihi: string;
  readonly musteri: string | null;
}

/** Paket bildirimin paketi mi? Künyenin müşterisi yoksa kanal-dışı paket kabul, varsa bildirimin kanalı olmalı. */
export function checkPackageBinding(m: ReleaseManifest, p: PackageIdentity): Result<true> {
  const off: string[] = [];
  if (p.kid !== m.paketImzaKid) off.push("kid");
  if (p.paketId !== m.paket.paketId) off.push("paketId");
  if (p.urun !== m.urun) off.push("urun");
  if (p.surum !== m.surum) off.push("surum");
  if (isoToMs(p.derlemeTarihi) !== isoToMs(m.derlemeTarihi)) off.push("derlemeTarihi");
  if (p.musteri !== null && p.musteri !== m.kanal) off.push("musteri");
  return off.length === 0 ? success(true) : failure("PAKET_BAGI", `Paket künyesi bildirimle bağlanmıyor: ${off.join(", ")}`);
}

// ── Sürüm karşılaştırma (semver önceliği; `+yapı` eki önceliğe girmez) ────────
export interface ParsedVersion {
  readonly core: readonly [number, number, number];
  readonly pre: readonly string[];
}

const VERSION_PARTS = /^([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,6})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Sürüm metni semver biçiminde mi (önceliği hesaplanabilir mi)? */
export function parseVersion(text: string): ParsedVersion | null {
  const m = VERSION_PARTS.exec(text);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^[0-9]+$/.test(a);
  const bn = /^[0-9]+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an !== bn) return an ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** −1 · 0 · 1; biri biçimsizse `null` (çağıran fail-closed davranır). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const c = compareIdentifiers(x.pre[i], y.pre[i]);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return x.pre.length === y.pre.length ? 0 : x.pre.length < y.pre.length ? -1 : 1;
}

// ── Karar sözlüğü (karar `guncelleme-karar.ts`te; rapor da taşır) ────────────
export const APPROVAL_TIMINGS = ["HEMEN", "PENCERE"] as const;
export type ApprovalTiming = (typeof APPROVAL_TIMINGS)[number];
export const UPDATE_DECISIONS = ["GUNCEL", "DONDURULDU", "UYGUN_DEGIL", "ONAY_BEKLIYOR", "PENCERE_BEKLIYOR", "KUR"] as const;
export type UpdateDecisionKind = (typeof UPDATE_DECISIONS)[number];
export const UPDATE_DECISION_REASONS = [
  "KIRA_YOK",
  "YAPTIRIM",
  "POLITIKA",
  "ADAY_YOK",
  "SURUM_GUNCEL",
  "HEDEF_ULASILDI",
  "KURULU_SURUM_BICIMSIZ",
  "HEDEF_DISI",
  "KAYNAK_SURUM_ESKI",
  "HAK_YOK",
  "BAKIM_DISI",
  "PG_OLCULEMEDI",
  "PG_ANA_SURUM",
  "PG_SURUMU_ESKI",
  "PENCERE_YOK",
  "ONAY_HEMEN",
  "PENCERE",
] as const;
export type UpdateDecisionReason = (typeof UPDATE_DECISION_REASONS)[number];

// ── Yoklamadaki güncelleme raporu (fabrika → satıcı; KATI allowlist, serbest metin yok) ──
export const UPDATER_STATES = ["CALISIYOR", "DURDU", "YOK", "OLCULEMEDI"] as const;
export const UPDATE_RESULTS = ["BASARILI", "GERI_DONDU", "BASARISIZ"] as const;
/** Sonuç kodlarının BELGELİ kümesi; tel desenle kabul eder (yeni güncelleyicinin kodu eski satıcıda yoklamayı düşürmesin). */
export const UPDATE_RESULT_CODES = [
  "INDIRME_HATASI",
  "IMZA_GECERSIZ",
  "PAKET_OZETI",
  "PAKET_BAGI",
  "BUTUNLUK_GECERSIZ",
  "DISK_DOLU",
  "DOSYA_KILITLI",
  "YEDEK_HATASI",
  "DURDURMA_HATASI",
  "PG_GUNCELLEME_HATASI",
  "GOC_HATASI",
  "BASLATMA_HATASI",
  "SAGLIK_HATASI",
  "KESINTI",
  "GERI_DONUS_HATASI",
  "BILINMEYEN",
] as const;
const ReportCodeSchema = z.string().regex(/^[A-Z0-9_]{2,40}$/);

export const UpdateResultSchema = z
  .strictObject({
    /** Güncelleyicide doğan deneme kimliği — satıcı `(kurulum, kayitId)` ile idempotent yazar. */
    kayitId: UuidSchema,
    hedefSurum: ReleaseVersionSchema,
    kaynakSurum: VersionTextSchema.nullable(),
    sonuc: z.enum(UPDATE_RESULTS),
    kod: ReportCodeSchema.nullable(),
    baslangic: IsoTimeSchema,
    bitis: IsoTimeSchema,
    /** Göç sonrası veri güncelleme öncesi yedekten geri yüklendi mi. */
    veriGeriYuklendi: z.boolean(),
  })
  .refine((r) => (r.sonuc === "BASARILI") === (r.kod === null), { message: "Başarılı sonuç kod taşımaz, başarısız sonuç taşır" })
  .refine((r) => isoToMs(r.bitis) >= isoToMs(r.baslangic), { message: "Bitiş başlangıçtan önce olamaz" });
export type UpdateResult = z.infer<typeof UpdateResultSchema>;

export const UpdateReportSchema = z.strictObject({
  /** Fabrikanın BUGÜNKÜ saat dilimi (dönem defteri) — satıcı pencere kuralını bununla mutlak aralığa çevirir. */
  saatDilimi: TimeZoneNameSchema,
  guncelleyici: z.strictObject({ durum: z.enum(UPDATER_STATES), surum: VersionTextSchema.nullable() }),
  /** En yeni adayın son kararı (güncelleyicinin durum dosyasından); aday yoksa null. */
  bekleyen: z.strictObject({ surum: ReleaseVersionSchema, karar: z.enum(UPDATE_DECISIONS), neden: ReportCodeSchema.nullable() }).nullable(),
  son: UpdateResultSchema.nullable(),
});
export type UpdateReport = z.infer<typeof UpdateReportSchema>;
