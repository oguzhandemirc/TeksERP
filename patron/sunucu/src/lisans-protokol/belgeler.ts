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
  /** Paket bütünlük listesi (PAKET anahtarıyla imzalı) — doğrulayan `lib/license/integrity.ts` + native çekirdek. */
  BUTUNLUK: "tekserp-butunluk",
  /** İlk kurulum kabul belgesi (KURULUM anahtarıyla imzalı, Ek-7) — doğrulayan satıcı (`kabul.ts`). */
  KABUL: "tekserp-kabul",
  /** Backend sürüm bildirimi (PAKET anahtarıyla imzalı, Dağıtım v2) — doğrulayan güncelleyici (`guncelleme.ts`). */
  SURUM: "tekserp-surum",
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
/**
 * YAYINLANAN backend sürümü: `x.y.z` ya da semver ön sürüm `x.y.z-rc.1` — `+yapı` eki YOK (önceliği
 * tanımsız, iki paket aynı sürüm sayılırdı) ve `..` doğamaz (sürüm URL yol segmentidir). `VersionTextSchema` alt kümesi.
 */
export const ReleaseVersionSchema = z.string().regex(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z]{1,20}(\.[0-9A-Za-z]{1,20}){0,3})?$/);
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

/** Modül anahtarı kimliği: `mk-` + sha256(önek ␟ anahtar) ilk 22 base64url (bkz. `modul-anahtari.ts`). */
export const ModuleKeyIdSchema = z.string().regex(/^mk-[A-Za-z0-9_-]{22}$/);

/** Kurulumun X25519 açık anahtarına sarılı modül anahtarı (Faz 2d): geçici X25519 → HKDF-SHA256 → AES-256-GCM. */
export const ModuleKeyWrapSchema = z.object({
  v: z.literal(1),
  modul: ModuleKeySchema,
  epk: PublicKeyXSchema,
  sarili: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
});
export type ModuleKeyWrap = z.infer<typeof ModuleKeyWrapSchema>;

/** Kiradaki modül anahtarı hakkı: `surum` anahtarın sürümü (döndürme), `kid` şifreli paketin başlığındaki kimlik. */
export const ModuleKeyGrantSchema = z
  .object({
    modul: ModuleKeySchema,
    surum: z.number().int().min(1),
    kid: ModuleKeyIdSchema,
    sarma: ModuleKeyWrapSchema,
  })
  .refine((g) => g.sarma.modul === g.modul, { message: "Sarmanın modülü hakkın modülüyle aynı olmalı" });
export type ModuleKeyGrant = z.infer<typeof ModuleKeyGrantSchema>;

const ModuleKeyGrantListSchema = z
  .array(ModuleKeyGrantSchema)
  .max(32)
  .refine((list) => isUnique(list.map((g) => g.kid)), "Modül anahtarı listesinde tekrar var");

// ── Güncelleme politikası (Dağıtım v2) — kiranın `guncelleme` alanı; anlatım docs/design/GUNCELLEYICI.md §2 ──
/** OTOMATIK: pencerede kendiliğinden · ONAYLI: yalnız yerel onayla · DONDUR: hiç (onay da açmaz). */
export const UPDATE_MODES = ["OTOMATIK", "ONAYLI", "DONDUR"] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];
/** Kiradaki mutlak aralık tavanı: 45 günlük kira × günde bir pencere + pay. */
export const UPDATE_INTERVAL_MAX = 64;
/** Bir mutlak aralık en çok 24 saatlik yerel pencere + yaz saati geçişinin 1 saati sürer. */
export const UPDATE_INTERVAL_MAX_MS = 25 * 60 * 60 * 1000;
const ClockStartSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const ClockEndSchema = z.string().regex(/^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/);
/** IANA saat dilimi adı (biçim); dilimin VARLIĞINI çağıran Intl'e sorar. */
export const TimeZoneNameSchema = z.string().max(64).regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/);

/**
 * İnsanın yazdığı pencere kuralı (portal/panel gösterimi): fabrika saatiyle `baslangic`–`bitis`, gün listesi
 * ISO haftası (1 = Pazartesi … 7 = Pazar) ve BAŞLANGIÇ gününe göre, artan sıralı; `bitis < baslangic` gece
 * yarısını aşar, `bitis = "24:00"` gün sonudur. Güncelleyici bu kuralı YORUMLAMAZ — mutlak aralıkları okur.
 */
export const UpdateWindowRuleSchema = z
  .object({
    baslangic: ClockStartSchema,
    bitis: ClockEndSchema,
    gunler: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    saatDilimi: TimeZoneNameSchema,
  })
  .refine((p) => p.gunler.every((g, i) => i === 0 || g > p.gunler[i - 1]), { message: "Gün listesi artan sıralı ve tekrarsız olmalı" })
  .refine((p) => p.baslangic !== p.bitis, { message: "Pencere başlangıcı ile bitişi aynı olamaz" });
export type UpdateWindowRule = z.infer<typeof UpdateWindowRuleSchema>;

/** Kuralın kira ömrü boyunca MUTLAK karşılığı — satıcı basarken hesaplar; güncelleyici saat dilimi hesabı yapmaz. */
export const UpdateIntervalSchema = z
  .object({ baslangic: IsoTimeSchema, bitis: IsoTimeSchema })
  .refine((a) => isoToMs(a.bitis) > isoToMs(a.baslangic), { message: "Aralık bitişi başlangıçtan sonra olmalı" })
  .refine((a) => isoToMs(a.bitis) - isoToMs(a.baslangic) <= UPDATE_INTERVAL_MAX_MS, { message: "Aralık 25 saatten uzun olamaz" });
export type UpdateInterval = z.infer<typeof UpdateIntervalSchema>;

const UpdateIntervalListSchema = z
  .array(UpdateIntervalSchema)
  .max(UPDATE_INTERVAL_MAX)
  .refine((list) => list.every((a, i) => i === 0 || isoToMs(a.baslangic) >= isoToMs(list[i - 1].bitis)), {
    message: "Aralıklar sıralı ve çakışmasız olmalı",
  });

export const LeaseUpdatePolicySchema = z
  .object({
    kip: z.enum(UPDATE_MODES),
    pencere: UpdateWindowRuleSchema.nullable(),
    araliklar: UpdateIntervalListSchema,
    /** Sabitleme: bu sürüm kurulur, ÖTESİNE geçilmez; kurulu sürüm daha yeniyse geri İNİLMEZ. */
    hedefSurum: ReleaseVersionSchema.nullable(),
  })
  .refine((g) => g.kip !== "OTOMATIK" || g.pencere !== null, { message: "Otomatik kip bir güncelleme penceresi ister" })
  .refine((g) => g.pencere !== null || g.araliklar.length === 0, { message: "Pencere kuralı yokken mutlak aralık olamaz" });
export type LeaseUpdatePolicy = z.infer<typeof LeaseUpdatePolicySchema>;

/** Kirada `guncelleme` YOKKEN (eski satıcı) geçerli politika = bugünkü davranış: hiçbir şey kendiliğinden kurulmaz. */
export function defaultUpdatePolicy(): LeaseUpdatePolicy {
  return { kip: "ONAYLI", pencere: null, araliklar: [], hedefSurum: null };
}

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
    /** Faz 2d: HAK'taki, dondurulmamış ve kurulumun X25519'u bilinen modüllerin anahtarları; yoksa şifreli modül açılmaz. */
    modulAnahtarlari: ModuleKeyGrantListSchema.optional(),
    /** Dağıtım v2: backend güncelleme politikası; yoksa `defaultUpdatePolicy()` (eski satıcı — eski backend alanı ATAR). */
    guncelleme: LeaseUpdatePolicySchema.optional(),
  })
  .refine((k) => isoToMs(k.bitis) > isoToMs(k.verilis), { message: "Kira bitişi verilişten sonra olmalı" })
  .refine((k) => isoToMs(k.bitis) - isoToMs(k.verilis) <= LEASE_MAX_DAYS * DAY_MS, {
    message: `Kira ömrü ${LEASE_MAX_DAYS} günü aşamaz`,
  })
  .refine(
    (k) => !k.guncelleme || k.guncelleme.araliklar.every((a) => isoToMs(a.bitis) > isoToMs(k.verilis) && isoToMs(a.baslangic) < isoToMs(k.bitis)),
    { message: "Güncelleme aralıkları kiranın ömrüyle kesişmeli" },
  );
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

/** Güncelleme sunucusunda kanal başına ürün dizinleri (`/<kanal>/<ürün>/`) — indirme belirtecinin önek kümesi. */
export const DOWNLOAD_PRODUCTS = ["electron", "mobil", "backend"] as const;
export type DownloadProduct = (typeof DOWNLOAD_PRODUCTS)[number];

export const DownloadSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    kanal: ChannelCodeSchema,
    yolOneki: z.string().max(80),
    kurulumId: UuidSchema,
    exp: IsoTimeSchema,
  })
  .refine((i) => DOWNLOAD_PRODUCTS.some((urun) => i.yolOneki === `/${i.kanal}/${urun}/`), {
    message: "Yol öneki kanalın electron/, mobil/ ya da backend/ dizini olmalı",
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
