// Protokol belgelerinin şemaları (v:1). Tek kaynak: satıcı imzalamadan ÖNCE, kurulum
// doğruladıktan SONRA aynı şemadan geçirir. Yeni alan v:1 içinde yalnız `.optional()`
// eklenir; anlamı daraltan her değişiklik `v`yi artırır (docs/design/LISANS-PROTOKOLU.md, "Sürümleme kuralı").
import { z } from "zod";
import type { KeyObject } from "node:crypto";
import { signJws } from "./jws";
import { DAY_MS, success, isPlainObject, failure, isoToMs, type Result } from "./ortak";

export const PROTOCOL_VERSION = 1;

/** Belge türleri — aynı anahtarın imzaladığı iki tür birbirinin yerine geçemez. */
export const TYP = {
  HAK: "tekserp-hak",
  KIRA: "tekserp-kira",
  ISTEK: "tekserp-istek",
  INDIRME: "tekserp-indirme",
  SERTIFIKA: "tekserp-sertifika",
  DURUM: "tekserp-durum",
} as const;

export const LICENSE_CLASSES = ["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];
export const SANCTION_LEVELS = ["K0", "K1", "K2", "K3", "K4", "K5"] as const;
export type SanctionLevel = (typeof SANCTION_LEVELS)[number];
export const CERT_USAGES = ["ALT", "INDIRME", "BAYI"] as const;
export type CertUsage = (typeof CERT_USAGES)[number];
export const REQUEST_PURPOSES = [
  "etkinlestir",
  "yokla",
  "zil",
  "cevrimdisi",
  "destek",
  "esitle",
  "tasima",
  "dr-devral",
] as const;
export type RequestPurpose = (typeof REQUEST_PURPOSES)[number];
/**
 * Kurulum kimliği (portalda doğan UUID, fabrikada LICENSE_DIR'de) henüz bilinmeyebilen amaçlar: anahtar
 * gövdeden gelir; etkinleştirmede kurulumu kod belirler, kimliksiz taşıma talebini onaylayan operatör eşler.
 */
export const INSTALLATION_ID_OPTIONAL_PURPOSES = ["etkinlestir", "tasima"] as const satisfies readonly RequestPurpose[];

export function isInstallationIdOptional(purpose: RequestPurpose): boolean {
  return (INSTALLATION_ID_OPTIONAL_PURPOSES as readonly RequestPurpose[]).includes(purpose);
}

/** Kiranın ömür tavanı: sızmış bir alt anahtarla geriye tarihli uzun kira basılamasın. */
export const LEASE_MAX_DAYS = 45;
export const GRACE_MAX_DAYS = 60;

export const IsoTimeSchema = z.iso.datetime();
export const UuidSchema = z.uuid();
/** Taşınmayan kurulum kimliği: alan yok · boş dizge · `null` — üçü de "yok"a (`undefined`) iner. */
export const OptionalInstallationIdSchema = z
  .union([UuidSchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => v || undefined);
/** sha256/HMAC-SHA256 özeti, base64url (43 karakter). */
export const DigestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const PublicKeyXSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const InstallationKidSchema = z.string().regex(/^kur-[A-Za-z0-9_-]{43}$/);
/** Modül anahtarı: `MODULE_SETTING_KEYS` biçimi (`finance.enabled`, `depo.multiEnabled`) ya da `patron-bulut`. */
export const ModuleKeySchema = z.string().max(64).regex(/^[a-z][A-Za-z0-9]*([.-][A-Za-z0-9]+)*$/);
export const ChannelCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export const VersionTextSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}([-+][0-9A-Za-z.-]{1,40})?$/);
export const JwsTextSchema = z.string().min(1).max(32 * 1024);
const NameSchema = z.string().min(1).max(200);

function isUnique(list: readonly string[]): boolean {
  return new Set(list).size === list.length;
}
const ModuleListSchema = z.array(ModuleKeySchema).max(64).refine(isUnique, "Modül listesinde tekrar var");
const ClassListSchema = z.array(z.enum(LICENSE_CLASSES)).min(1).refine(isUnique, "Sınıf listesinde tekrar var");

export const FingerprintSchema = z.strictObject({
  f1: DigestSchema.nullable(),
  f2: DigestSchema.nullable(),
  f3: DigestSchema.nullable(),
  f4: DigestSchema.nullable(),
  f5: DigestSchema.nullable(),
});

export const EntitlementSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    hakId: UuidSchema,
    surum: z.number().int().min(1),
    lisansNo: z.string().regex(/^TKS-\d{4}-\d{4,6}$/),
    musteri: z.object({ id: UuidSchema, ad: NameSchema }),
    tesis: z.object({ id: UuidSchema, ad: NameSchema }),
    kurulumId: UuidSchema,
    sinif: z.enum(LICENSE_CLASSES),
    moduller: ModuleListSchema,
    kalici: z.boolean(),
    bakimBitis: IsoTimeSchema,
    verilis: IsoTimeSchema,
    bayiId: UuidSchema.optional(),
    /** Bayi imzalı HAK'ta imzalayan anahtarın kök imzalı sertifikası. */
    bayiSertifikasi: JwsTextSchema.optional(),
  })
  .refine((h) => !h.bayiSertifikasi || h.bayiId, { message: "Bayi sertifikalı HAK bayiId taşımalı" });
export type EntitlementDoc = z.infer<typeof EntitlementSchema>;

const SanctionSchema = z
  .object({
    kademe: z.enum(SANCTION_LEVELS).nullable(),
    mesaj: z.string().max(500).nullable(),
    kisitlamaTarihi: IsoTimeSchema.nullable(),
    donmusModuller: ModuleListSchema,
    guncellemeDonuk: z.boolean(),
  })
  .refine((y) => y.kademe !== "K3" || y.kisitlamaTarihi !== null, {
    message: "K3 kısıtlama tarihi taşımalı",
  });

export const LeaseSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    kiraId: UuidSchema,
    hakId: UuidSchema,
    hakSurum: z.number().int().min(1),
    kurulumId: UuidSchema,
    kurulumAnahtarKimligi: InstallationKidSchema,
    parmakIzi: FingerprintSchema,
    verilis: IsoTimeSchema,
    bitis: IsoTimeSchema,
    sunucuSaati: IsoTimeSchema,
    ekSureGun: z.number().int().min(0).max(GRACE_MAX_DAYS),
    zorlama: z.boolean(),
    gecerlilikBitis: IsoTimeSchema.nullable(),
    yaptirim: SanctionSchema,
    yoklamaAraligiDk: z.number().int().min(5).max(1440),
    esitlemeAraligiDk: z.number().int().min(1).max(1440).nullable(),
    patronBulutBitis: IsoTimeSchema.nullable(),
    devredildi: z.boolean(),
    kanal: z.object({
      kod: ChannelCodeSchema,
      guncelSurumler: z.object({
        backend: VersionTextSchema.optional(),
        panel: VersionTextSchema.optional(),
        tablet: VersionTextSchema.optional(),
      }),
    }),
    altSertifika: JwsTextSchema,
  })
  .refine((k) => isoToMs(k.bitis) > isoToMs(k.verilis), { message: "Kira bitişi verilişten sonra olmalı" })
  .refine((k) => isoToMs(k.bitis) - isoToMs(k.verilis) <= LEASE_MAX_DAYS * DAY_MS, {
    message: `Kira ömrü ${LEASE_MAX_DAYS} günü aşamaz`,
  });
export type LeaseDoc = z.infer<typeof LeaseSchema>;

export const RequestSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    kurulumId: OptionalInstallationIdSchema,
    zaman: IsoTimeSchema,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
    amac: z.enum(REQUEST_PURPOSES),
    govdeOzeti: DigestSchema,
  })
  .refine((r) => r.kurulumId !== undefined || isInstallationIdOptional(r.amac), {
    message: "Kurulum kimliği yalnız etkinleştirme ve taşıma isteğinde boş olabilir",
    path: ["kurulumId"],
  });
export type RequestDoc = z.infer<typeof RequestSchema>;

export const DownloadSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    kanal: ChannelCodeSchema,
    yolOneki: z.string().max(80),
    kurulumId: UuidSchema,
    exp: IsoTimeSchema,
  })
  .refine((i) => i.yolOneki === `/${i.kanal}/electron/` || i.yolOneki === `/${i.kanal}/mobil/`, {
    message: "Yol öneki kanalın electron/ ya da mobil/ dizini olmalı",
  });
export type DownloadDoc = z.infer<typeof DownloadSchema>;

const SUB_KID_PREFIX: Record<CertUsage, string> = { ALT: "alt-", INDIRME: "ind-", BAYI: "bayi-" };

export const CertificateSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    sertifikaId: UuidSchema,
    kullanim: z.enum(CERT_USAGES),
    kid: z.string().regex(/^[a-z]+-[a-z0-9-]{1,60}$/),
    x: PublicKeyXSchema,
    siniflar: ClassListSchema,
    baslangic: IsoTimeSchema,
    bitis: IsoTimeSchema,
    bayi: z.object({ bayiId: UuidSchema, moduller: ModuleListSchema }).nullable(),
  })
  .refine((s) => isoToMs(s.bitis) > isoToMs(s.baslangic), { message: "Sertifika bitişi başlangıçtan sonra olmalı" })
  .refine((s) => s.kid.startsWith(SUB_KID_PREFIX[s.kullanim]), { message: "kid öneki kullanımla uyuşmuyor" })
  .refine((s) => (s.kullanim === "BAYI") === (s.bayi !== null), { message: "Bayi tavanı yalnız BAYI sertifikasında" });
export type CertificateDoc = z.infer<typeof CertificateSchema>;

/**
 * Yükü şemadan geçirir. Bilinmeyen `v` şema hatasından AYRI kodlanır: sürüm uyuşmazlığı
 * bir saldırı değil bir yükseltme sinyalidir ve portala öyle raporlanır.
 */
export function decodeDocument<T>(schema: z.ZodType<T>, payload: unknown): Result<T> {
  if (isPlainObject(payload) && "v" in payload && payload.v !== PROTOCOL_VERSION) {
    return failure("BELGE_SURUM", `Desteklenmeyen protokol sürümü: ${String(payload.v)}`);
  }
  const s = schema.safeParse(payload);
  if (s.success) return success(s.data);
  const first = s.error.issues[0];
  const path = first ? first.path.join(".") : "";
  return failure("BELGE_SEMA", `Belge şemaya uymuyor${path ? ` (${path})` : ""}: ${first?.message ?? "bilinmiyor"}`);
}

/**
 * Şemadan geçmeyen belge İMZALANMAZ (programcı hatası, fırlatır). İmzalanan, şemanın
 * ÇIKTISIDIR: tanınmayan alan imzaya girip doğrulayanda sessizce düşmesin.
 */
export function signDocument<T extends Record<string, unknown>>(g: {
  readonly typ: string;
  readonly schema: z.ZodType<T>;
  readonly payload: T;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
}): string {
  const s = decodeDocument(g.schema, g.payload);
  if (!s.ok) throw new Error(`signDocument(${g.typ}): ${s.message}`);
  return signJws({ typ: g.typ, kid: g.key.kid, payload: s.value, privateKey: g.key.privateKey });
}
