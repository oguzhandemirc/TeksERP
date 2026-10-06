// Protokol belgelerinin şemaları (v:1). Tek kaynak: satıcı imzalamadan ÖNCE, kurulum
// doğruladıktan SONRA aynı şemadan geçirir. Yeni alan v:1 içinde yalnız `.optional()`
// eklenir; anlamı daraltan her değişiklik `v`yi artırır (docs/design/LISANS-PROTOKOLU.md, "Sürümleme kuralı").
import { z } from "zod";
import type { KeyObject } from "node:crypto";
import { signJws } from "./jws";
import { DAY_MS, success, isPlainObject, failure, isoToMs, type Result } from "./ortak";
import { FINGERPRINT_RULES } from "./parmak-izi";
import { PROTOCOL_VERSION } from "./belge-turleri";

export { PROTOCOL_VERSION, TYP } from "./belge-turleri";

export const LICENSE_CLASSES = ["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];
/** Patron bulutuna veri GÖNDEREBİLEN sınıflar — fabrika ön koşulu ve bulutun kurulum kapısı bu tek kaynaktan okur. */
export const CLOUD_SENDER_CLASSES: readonly LicenseClass[] = ["URETIM", "BARINDIRILAN", "DEMO"];
export function isCloudSenderClass(sinif: string): boolean {
  return (CLOUD_SENDER_CLASSES as readonly string[]).includes(sinif);
}
export const SANCTION_LEVELS = ["K0", "K1", "K2", "K3", "K4", "K5"] as const;
export type SanctionLevel = (typeof SANCTION_LEVELS)[number];
/**
 * `HAK`: HAK ara imzacısı (G4) — kök → ara sertifika → HAK; yalnız `hak-ara` yeteneğini bildiren kuruluma gider.
 * `PAKET`: paket belgelerini imzalayan kök sertifikalı anahtar (`pkt-`, `paket-zinciri.ts`).
 */
export const CERT_USAGES = ["ALT", "INDIRME", "BAYI", "HAK", "PAKET"] as const;
export type CertUsage = (typeof CERT_USAGES)[number];
/** `tekserp-iptal` satırının kullanımları — PAKET YOK (iptali ayrı belgededir, `TYP.PAKET_IPTAL`). */
export const REVOCATION_USAGES = ["ALT", "INDIRME", "BAYI", "HAK"] as const satisfies readonly CertUsage[];
export const REQUEST_PURPOSES = [
  "etkinlestir",
  "yokla",
  "zil",
  "cevrimdisi",
  "destek",
  "esitle",
  "tasima",
  "dr-devral",
  /** Panelden "donanım değişikliğini bildir" (K8) — `POST /v1/donanim` ya da zarfla QR yolu. */
  "donanim",
  /** Müşteri onaylı hata raporu — `POST /v1/hata-raporu`; yoklamaya karışmaz. */
  "hata-raporu",
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
/** HAK çevrimdışı ufkunun şema sınırı (gün); sınıf ve imzacı tavanı ayrıca zincirde (`offlineHorizonCeilingDays`). */
export const OFFLINE_HORIZON_MAX_DAYS = 3650;
/** Satıcının varsayılan ufku ve bayi tavanı (gün). */
export const OFFLINE_HORIZON_DEALER_DAYS = 400;
/** DEMO ve TEST sınıflarının ufuk tavanı (gün). */
export const OFFLINE_HORIZON_SHORT_CLASS_DAYS = 45;
/** Kapanış kirasının nedeni (K6) — bilgi alanı; kısıtlamayı kiranın K3'ü getirir. */
export const CLOSING_LEASE_REASONS = ["KOPYA", "TASIMA", "IPTAL"] as const;
export type ClosingLeaseReason = (typeof CLOSING_LEASE_REASONS)[number];

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
/** Satıcı/patron uç yolu: `/v1/<parça>[/<parça>…]` (en çok dört parça). */
export const RequestPathSchema = z.string().regex(/^\/v1(\/[a-z0-9-]{1,40}){1,4}$/);
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
    /** Ara imzalı HAK'ta (G4) imzalayan anahtarın kök imzalı `HAK` sertifikası. */
    imzaciSertifikasi: JwsTextSchema.optional(),
    /** Çevrimdışı ufuk (gün; `null` = süresiz). Yoksa P modeli uygulanmaz, eski çapa sürer. */
    cevrimdisiUfukGun: z.number().int().min(1).max(OFFLINE_HORIZON_MAX_DAYS).nullable().optional(),
    /** Kip alt sınırı: kira, durum kaydı ve derleme varsayılanı bunun altına inemez. */
    kipAltSiniri: z.literal("zorla").optional(),
  })
  .refine((h) => !h.bayiSertifikasi || h.bayiId, { message: "Bayi sertifikalı HAK bayiId taşımalı" })
  .refine((h) => !h.bayiSertifikasi || !h.imzaciSertifikasi, { message: "HAK hem bayi hem ara imzacı sertifikası taşıyamaz" });
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
    /** Ödenmiş tarih P (`null` = süresiz). HAK `cevrimdisiUfukGun` ile birlikte varsa P modeli işler. */
    odenmisTarih: IsoTimeSchema.nullable().optional(),
    /** Parmak izi kuralı (K8); yoksa eski kural (ölçülemeyen etken sayılmaz). */
    parmakIziKurali: z.enum(FINGERPRINT_RULES).optional(),
    /** Kapanış kirası (K6): bilgi alanı, anlamı K3 taşır. */
    kapanis: z.enum(CLOSING_LEASE_REASONS).optional(),
    /** Bağlı HAK'ın bayt özeti (`jwsDigest`): aynı kimlik ve sürümle basılmış başka HAK bu kiraya bağlanamaz. */
    hakOzeti: DigestSchema.optional(),
    /** Satıcının yanıtla dağıttığı iptal belgesinin sırası: fabrika daha düşük sıralı belgeyle yetinmez. */
    iptalSira: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    /** Satıcı bu kirayı canlı yanıtta istek bağıyla (`yanitBagi`) teslim eder: bağsız canlı teslim RED (bağ soyulamaz). */
    yanitBagli: z.literal(true).optional(),
  })
  .refine((k) => isoToMs(k.bitis) > isoToMs(k.verilis), { message: "Kira bitişi verilişten sonra olmalı" })
  .refine((k) => isoToMs(k.bitis) - isoToMs(k.verilis) <= LEASE_MAX_DAYS * DAY_MS, {
    message: `Kira ömrü ${LEASE_MAX_DAYS} günü aşamaz`,
  })
  .refine(
    (k) => !k.guncelleme || k.guncelleme.araliklar.every((a) => isoToMs(a.bitis) > isoToMs(k.verilis) && isoToMs(a.baslangic) < isoToMs(k.bitis)),
    { message: "Güncelleme aralıkları kiranın ömrüyle kesişmeli" },
  )
  .refine((k) => k.kapanis === undefined || k.yaptirim.kademe === "K3", { message: "Kapanış kirası K3 yaptırımı taşımalı" });
export type LeaseDoc = z.infer<typeof LeaseSchema>;

/** İsteğin tek seferlik sayısı (base64url 22–64). */
export const RequestNonceSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);

export const RequestSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    kurulumId: OptionalInstallationIdSchema,
    zaman: IsoTimeSchema,
    nonce: RequestNonceSchema,
    amac: z.enum(REQUEST_PURPOSES),
    govdeOzeti: DigestSchema,
    /** İsteğin gittiği uç yolu (zarfla taşınanda taşıyan uç `/v1/cevrimdisi`); varsa doğrulayan eşitliği denetler. */
    yol: RequestPathSchema.optional(),
  })
  .refine((r) => r.kurulumId !== undefined || isInstallationIdOptional(r.amac), {
    message: "Kurulum kimliği yalnız etkinleştirme ve taşıma isteğinde boş olabilir",
    path: ["kurulumId"],
  });
export type RequestDoc = z.infer<typeof RequestSchema>;

const SUB_KID_PREFIX: Record<CertUsage, string> = { ALT: "alt-", INDIRME: "ind-", BAYI: "bayi-", HAK: "ara-", PAKET: "pkt-" };
const CERT_KID_PATTERN = /^[a-z]+-[a-z0-9-]{1,60}$/;

export const CertificateSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    sertifikaId: UuidSchema,
    kullanim: z.enum(CERT_USAGES),
    kid: z.string().regex(CERT_KID_PATTERN),
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

export const REVOCATION_MAX_ENTRIES = 256;
const RevocationEntrySchema = z
  .object({
    kid: z.string().regex(CERT_KID_PATTERN),
    sertifikaId: UuidSchema,
    kullanim: z.enum(REVOCATION_USAGES),
    tarih: IsoTimeSchema,
    neden: z.string().max(200),
  })
  .refine((e) => e.kid.startsWith(SUB_KID_PREFIX[e.kullanim]), { message: "kid öneki kullanımla uyuşmuyor" });

/** İPTAL (G4 §2.3): listelenen sertifika TÜMDEN geçersizdir; `sira` tekdüze artar, düşük sıralı belge yok sayılır. */
export const RevocationSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  iptalId: UuidSchema,
  sira: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  verilis: IsoTimeSchema,
  iptaller: z
    .array(RevocationEntrySchema)
    .max(REVOCATION_MAX_ENTRIES)
    .refine((list) => isUnique(list.map((e) => e.sertifikaId)), "İptal listesinde tekrarlı sertifika"),
});
export type RevocationDoc = z.infer<typeof RevocationSchema>;

/**
 * YANIT BAĞI (6.3c): canlı lisans yanıtındaki kirayı (`kiraOzeti` = `jwsDigest(kira)`) yanıtın cevapladığı isteğin
 * nonce'una bağlar. ALT imzalıdır ve kendi alt sertifikasını gömer — aynı kirayı yeniden veren yol (tekrar · kapanış)
 * kirayı imzalayandan başka bir ALT anahtarla bağlayabilir.
 */
export const ResponseBindingSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  kiraOzeti: DigestSchema,
  istekNonce: RequestNonceSchema,
  verilis: IsoTimeSchema,
  altSertifika: JwsTextSchema,
});
export type ResponseBindingDoc = z.infer<typeof ResponseBindingSchema>;

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
