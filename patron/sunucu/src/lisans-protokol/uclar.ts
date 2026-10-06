// Satıcı uçlarının gövde sözleşmesi (v:1). İstek gövdeleri KATI (tanınmayan anahtar RED:
// yoklama iş verisi taşımaz, allowlist'in dışı sessizce sızamaz); yanıt gövdeleri
// GEVŞEK (sunucu v:1 içinde yeni bilgi alanı ekleyebilir, eski kurulum yok sayar).
import { randomInt } from "node:crypto";
import { z } from "zod";
import {
  PublicKeyXSchema,
  IsoTimeSchema,
  JwsTextSchema,
  DigestSchema,
  FingerprintSchema,
  OptionalInstallationIdSchema,
  PROTOCOL_VERSION,
  VersionTextSchema,
  UuidSchema,
  ModuleKeySchema,
} from "./belgeler";
import { UpdateReportSchema } from "./guncelleme";
import { FINGERPRINT_FACTORS } from "./parmak-izi";
import { isPlainObject } from "./ortak";

export const ENDPOINTS = {
  ACTIVATE: "/v1/etkinlestir",
  POLL: "/v1/yokla",
  DOORBELL: "/v1/zil",
  OFFLINE: "/v1/cevrimdisi",
  TRANSFER: "/v1/tasima",
  DR_TAKEOVER: "/v1/dr-devral",
  SUPPORT: "/v1/destek",
  /** Donanım değişikliği bildirimi (K8) — gövde `donanim.ts`. */
  HARDWARE: "/v1/donanim",
  /** Müşteri onaylı hata raporu — gövde `hata-raporu.ts`. */
  ERROR_REPORT: "/v1/hata-raporu",
} as const;

export const VALIDITY_VALUES = ["GECERLI", "GECERSIZ", "OLCULEMEDI"] as const;
export type Validity = (typeof VALIDITY_VALUES)[number];
/** Şiddet sırasıyla: dizideki sıra karşılaştırmada kullanılır. */
export const STATE_TIERS = ["NORMAL", "UYARI", "EK_SURE", "KISITLI", "DURDURULMUS"] as const;
export type StateTier = (typeof STATE_TIERS)[number];
export const LICENSE_MODES = ["gozlem", "zorla"] as const;
export type LicenseMode = (typeof LICENSE_MODES)[number];

export const POLL_DEFAULT_MINUTES = 60;
/** İmzalı saat sapması uyarı eşiği (sn): sunucu duvar saati − satıcının imzalı kira saati; yalnız bilgi, kademeye girmez. */
export const SIGNED_SKEW_WARN_SECONDS = 300;
export const DOORBELL_HEARTBEAT_SECONDS = 25;
export const DOORBELL_EVENT_NAME = "zil";
export const DOORBELL_TOPICS = ["lisans", "gelen-kutusu", "ozet", "rapor", "guncelleme", "destek"] as const;
export const DoorbellEventSchema = z.object({ konu: z.enum(DOORBELL_TOPICS) });

/** Crockford base32: I/L/O/U yok — elle yazımda karışmaz. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_PREFIX = "TKS";
const CODE_BLOCK_LENGTH = 4;
/** Üretilen kod: 16 karakter (4 blok, ≈80 bit) — `TKS-XXXX-XXXX-XXXX-XXXX`. */
export const ACTIVATION_CODE_LENGTH = 16;
/** Eski 12 karakterlik biçim (3 blok) BİR SÜRÜM daha TANINIR; üretilmez. */
export const LEGACY_ACTIVATION_CODE_LENGTH = 12;
const CODE_BODY_LENGTHS: readonly number[] = [LEGACY_ACTIVATION_CODE_LENGTH, ACTIVATION_CODE_LENGTH];
const CODE_BLOCK = `[${CODE_ALPHABET}]{${CODE_BLOCK_LENGTH}}`;
export const ActivationCodeSchema = z
  .string()
  .regex(new RegExp(`^${CODE_PREFIX}(-${CODE_BLOCK}){${LEGACY_ACTIVATION_CODE_LENGTH / CODE_BLOCK_LENGTH},${ACTIVATION_CODE_LENGTH / CODE_BLOCK_LENGTH}}$`));

/** Kod türü: `ilk` hiç etkinleşmemiş kurulumu açar; `tasima` onaylı taşıma talebinin tek kullanımlık kodudur. */
export const ACTIVATION_CODE_KINDS = ["ilk", "tasima"] as const;
export type ActivationCodeKind = (typeof ACTIVATION_CODE_KINDS)[number];

function formatActivationCode(body: string): string {
  const blocks = body.match(new RegExp(`.{${CODE_BLOCK_LENGTH}}`, "g")) ?? [];
  return [CODE_PREFIX, ...blocks].join("-");
}

/** Yeni kod (yalnız 16 karakterlik biçim). Düz metin yalnız üretim anında vardır; saklama satıcının işi. */
export function generateActivationCode(): string {
  const body = Array.from({ length: ACTIVATION_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return ActivationCodeSchema.parse(formatActivationCode(body));
}

/** Kullanıcının yazdığı kodu kanonik biçime getirir (büyük harf, O→0, I/L→1, tire yerleşimi; 12 ve 16 karakter). */
export function normalizeActivationCode(text: string): string {
  const alnum = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const prefixed = alnum.startsWith(CODE_PREFIX) && CODE_BODY_LENGTHS.includes(alnum.length - CODE_PREFIX.length);
  const body = (prefixed ? alnum.slice(CODE_PREFIX.length) : alnum).replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!CODE_BODY_LENGTHS.includes(body.length)) return text.trim().toUpperCase();
  return formatActivationCode(body);
}

export const EnvironmentSchema = z.strictObject({
  platform: z.enum(["win32", "linux", "darwin"]),
  mimari: z.enum(["x64", "arm64"]),
  isletimSistemi: z.string().max(120),
  nodeSurum: z.string().regex(/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  uygulamaSurum: VersionTextSchema,
  derlemeTarihi: IsoTimeSchema.nullable(),
  konteyner: z.boolean(),
  /** Fabrika DB'sinin `system.installationId`si — YALNIZ BİLGİ (dökümle kopyalanır, lisans kimliği DEĞİL). */
  installationId: UuidSchema.optional(),
});

const CounterSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ShortCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/**
 * Sağlık özeti ALLOWLIST'i: yalnız sayılar ve kapalı kümeler. Ham hata metni, dosya adı,
 * kullanıcı adı, iş verisi GİRMEZ — serbest metin alanı bilerek yok.
 */
export const HealthSummarySchema = z.strictObject({
  surum: VersionTextSchema,
  calismaSn: CounterSchema,
  dbBoyutBayt: CounterSchema.nullable(),
  yedek: z.strictObject({
    hukum: z.enum(["ok", "uyari", "kritik", "yapilandirilmamis"]),
    yasSaat: z.number().min(0).max(1e6).nullable(),
  }),
  offsite: z.strictObject({ yapilandirildi: z.boolean(), ok: z.boolean().nullable(), eksikSayisi: CounterSchema.nullable() }),
  diskDolulukYuzde: z.number().min(0).max(100).nullable(),
  auditYazmaHatasi: CounterSchema,
  havuzZamanAsimi: CounterSchema,
  istemciler: z.array(z.strictObject({ tur: z.enum(["panel", "tablet", "web", "diger"]), surum: VersionTextSchema, adet: CounterSchema })).max(50),
  isHatalari: z.array(z.strictObject({ is: ShortCodeSchema, adet: CounterSchema })).max(50),
});

export const StateSummarySchema = z.strictObject({
  gecerlilik: z.enum(VALIDITY_VALUES),
  nedenler: z.array(z.string().regex(/^[A-Z0-9_]{2,40}$/)).max(40),
  kip: z.enum(LICENSE_MODES),
  hesaplananKademe: z.enum(STATE_TIERS),
  uygulananKademe: z.enum(STATE_TIERS),
});

const VersionField = z.literal(PROTOCOL_VERSION);

/**
 * Kurulumun bildirdiği yetenekler: daraltan yeni biçimler (ara imzacı zinciri, ufuk, kip alt sınırı, parmak izi
 * kuralı, iptal) YALNIZ bildiren kuruluma gider. Liste AÇIK biçimli dizgedir (kapalı enum değil): tanımadığı
 * yeteneği satıcı yok sayar, yeni fabrika eski satıcıdan 400 almaz.
 */
export const LICENSE_CAPABILITIES = Object.freeze(["hak-ara", "odenmis-tarih", "iptal", "parmak-izi-v2", "paket-zinciri"] as const);
export type LicenseCapability = (typeof LICENSE_CAPABILITIES)[number];
const CapabilitySchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
export const CapabilityListSchema = z
  .array(CapabilitySchema)
  .max(32)
  .refine((list) => new Set(list).size === list.length, "Yetenek listesinde tekrar var");
export function hasCapability(list: readonly string[] | undefined, capability: LicenseCapability): boolean {
  return list?.includes(capability) ?? false;
}

/** Süren ölçülemedi birikimi (G12): çalışma süresi ms + ilk başlangıç; yerel müdahale şüphesinin girdisi. */
export const UncertaintySummarySchema = z.strictObject({ birikenMs: CounterSchema, ilk: IsoTimeSchema.nullable() });
/** İmzalı durum kaydının sırası (`null` = kayıt yok) ve geçerliliği: sıranın gerilemesi satıcıda görünür. */
export const StateRecordSummarySchema = z.strictObject({ sira: CounterSchema.nullable(), gecerli: z.boolean() });
/** Kayıp etkenler (K8): kabul kümesinde değeri olup 24 saattir hiçbir yoldan okunamayanlar. */
export const LostFactorListSchema = z
  .array(z.enum(FINGERPRINT_FACTORS))
  .max(FINGERPRINT_FACTORS.length)
  .refine((list) => new Set(list).size === list.length, "Kayıp etken listesinde tekrar var");

/** Etkinleştirme: kurulum kimliği portalda doğar ve YANITLA gelir — istek onu taşımaz (yok/boş kabul). */
export const ActivateRequestSchema = z.strictObject({
  v: VersionField,
  kod: ActivationCodeSchema,
  kurulumId: OptionalInstallationIdSchema,
  acikAnahtar: PublicKeyXSchema,
  /** Kurulumun X25519 AÇIK anahtarı (Faz 2d): modül anahtarları buna sarılır. İstek kurulum anahtarıyla imzalıdır. */
  sifrelemeAnahtari: PublicKeyXSchema.optional(),
  parmakIzi: FingerprintSchema,
  ortam: EnvironmentSchema,
  yetenekler: CapabilityListSchema.optional(),
  belirsizlik: UncertaintySummarySchema.optional(),
  durumKaydi: StateRecordSummarySchema.optional(),
  parmakIziKayip: LostFactorListSchema.optional(),
  /**
   * İlk kurulum kabul belgesi (`tekserp-kabul`, KURULUM imzalı — `kabul.ts`). Şemada opsiyonel (v:1 uyumu, eski
   * gövde anlamlı kodla reddedilsin); satıcı iş kuralıyla ZORUNLU tutar → 409 `KABUL_GEREKLI`. KATI gövde ⇒ satıcı önce.
   */
  kabul: JwsTextSchema.optional(),
});

// ── Kurulum kaydı (3d-2) ──────────────────────────────────────────────────────
/** `kur.ps1`in kurulum kökündeki ekleme-yalnız geçmiş dosyası; yoklama son N satırı taşır. */
export const INSTALL_HISTORY_FILE_NAME = "kurulum-gecmisi.jsonl";
export const INSTALL_RECORD_LIMIT = 10;
export const INSTALL_RECORD_KINDS = ["KURULUM", "GERI_ALMA"] as const;
/** Geri dönüş noktası DAMGA olarak gider (`app.eski-<damga>` · `premigrate_<damga>`): dosya adı/yol dışarı çıkmaz. */
const RecoveryStampSchema = z.string().regex(/^\d{8}_\d{6}$/);

/** Kurulum kaydı ALLOWLIST'i — `kayitId` kur.ps1'de doğar; satıcı (kurulum, kayitId) ile idempotent yazar. */
export const InstallRecordSchema = z.strictObject({
  kayitId: UuidSchema,
  tur: z.enum(INSTALL_RECORD_KINDS),
  tarih: IsoTimeSchema,
  commit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
  paketOzeti: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  oncekiSurum: VersionTextSchema.nullable(),
  yeniSurum: VersionTextSchema,
  migrationSayisi: CounterSchema.nullable(),
  yeniMigrationSayisi: CounterSchema.nullable(),
  geriDonus: z.strictObject({ damga: RecoveryStampSchema.nullable(), kod: z.boolean(), veri: z.boolean(), veriSifreli: z.boolean() }),
});
export type InstallRecord = z.infer<typeof InstallRecordSchema>;
/** Yoklama gövdesindeki OPSİYONEL alan (yoksa bugünkü gövde). Eski satıcı KATI şemayla reddeder ⇒ satıcı önce. */
export const InstallRecordListSchema = z.array(InstallRecordSchema).max(INSTALL_RECORD_LIMIT);

export const PollRequestSchema = z.strictObject({
  v: VersionField,
  /** Kira zinciri: sunucu ucu tutar; geride kalmış uç "yakala", iki farklı parmak izi "kopya şüphesi". */
  sonKiraId: UuidSchema.nullable(),
  /** `ozet`: HAK JWS metninin sha256'sı (`jwsDigest`) — aynı kimlik ve sürümle basılmış yabancı HAK'ı ayırır. */
  hak: z.strictObject({ hakId: UuidSchema, surum: z.number().int().min(1), ozet: DigestSchema.optional() }).nullable(),
  /** Kurulumun X25519 açık anahtarı (Faz 2d) — eski kurulum ilk yoklamada üretip bildirir. */
  sifrelemeAnahtari: PublicKeyXSchema.optional(),
  parmakIzi: FingerprintSchema,
  durum: StateSummarySchema,
  saat: z.strictObject({
    duvar: IsoTimeSchema,
    guvenilir: IsoTimeSchema,
    bulgu: z.enum(["SAAT_ILERI", "SAAT_GERI"]).nullable(),
    /** Son `ISTEK_ZAMAN` yanıtından ölçülen duvar − satıcı saati (sn); yok = ölçülmedi. Bilgidir, kademeye girmez. */
    saticiSapmaSn: z.number().int().min(-1e9).max(1e9).optional(),
    /** Son CANLI kira kabulünde imzalı `kira.sunucuSaati`nden ölçülen duvar − imzalı saat (sn); yok = ölçülmedi. Bilgidir; satıcı ÖNCE. */
    imzaliSapmaSn: z.number().int().min(-1e9).max(1e9).optional(),
  }),
  ortam: EnvironmentSchema,
  saglik: HealthSummarySchema,
  /** Gözlem kipinde zorlamanın REDDEDECEĞİ istek/modül sayısı (sıfır-fark ölçümü). */
  gozlem: z.strictObject({ reddedilecekIstek: CounterSchema, reddedilecekModul: CounterSchema }),
  /** Son N kurulum kaydı (3d-2) — yoksa alan hiç gönderilmez (eski satıcı KATI şemayla reddederdi). */
  kurulumKayitlari: InstallRecordListSchema.optional(),
  /** Dağıtım v2 güncelleme raporu (dilim, güncelleyici, bekleyen karar, son sonuç) — yoksa alan HİÇ gönderilmez; satıcı ÖNCE. */
  guncelleme: UpdateReportSchema.optional(),
  /** Lisans v2 ekleri — yalnız doluysa gönderilir; eski satıcı KATI şemayla reddeder ⇒ satıcı önce. */
  yetenekler: CapabilityListSchema.optional(),
  belirsizlik: UncertaintySummarySchema.optional(),
  durumKaydi: StateRecordSummarySchema.optional(),
  parmakIziKayip: LostFactorListSchema.optional(),
  /**
   * K10 — fabrikada AÇIK (bayrak ∧ lisans tavanı) modül adları (`finance.enabled` …). Ad YAPILANDIRMADIR, iş verisi
   * değil; alan yoksa fabrika bildirmiyor (portal "bilinmiyor" der). Yalnız doluysa gider; satıcı ÖNCE.
   */
  acikModuller: z.array(ModuleKeySchema).max(64).refine((l) => new Set(l).size === l.length, "Modül listesinde tekrar var").optional(),
});

/**
 * Taşıma YALNIZ TALEP açar (kod taşımaz): satıcı onayında tek kullanımlık `tasima` türü kod üretilir ve
 * yeni makine onu normal etkinleştirme yolundan kullanır. Yeni makine kurulum kimliğini bilmeyebilir.
 */
export const TransferRequestSchema = z.strictObject({
  v: VersionField,
  kurulumId: OptionalInstallationIdSchema,
  acikAnahtar: PublicKeyXSchema,
  parmakIzi: FingerprintSchema,
  ortam: EnvironmentSchema,
  gerekce: z.string().max(500).nullable(),
});

/** `anaKurulumId` verilmezse satıcı tesisin TEK etkin ÜRETİM kurulumunu çıkarır (0 ya da >1 → 409 `DR_ANA_BELIRSIZ`). */
export const DrTakeoverRequestSchema = z.strictObject({
  v: VersionField,
  anaKurulumId: UuidSchema.optional(),
  gerekce: z.string().min(1).max(500),
});

export const OfflineRequestSchema = z.strictObject({ v: VersionField, zarf: z.string().min(1).max(64 * 1024) });

/** Etkinleştir · yokla · çevrimdışı · DR yanıtı. `hak` yalnız değiştiyse (ya da kurulumda yoksa) gelir. */
export const LicenseResponseSchema = z.object({
  v: VersionField,
  hak: JwsTextSchema.nullable(),
  kira: JwsTextSchema,
  indirmeBelirtecleri: z.array(z.object({ yolOneki: z.string().max(80), belirtec: JwsTextSchema })).max(4),
  sunucuSaati: IsoTimeSchema,
  /** Lisans kimliği — etkinleştirme yanıtında daima; imzalı kiranın `kurulumId`siyle aynı olmalı (otorite kiradır). */
  kurulumId: UuidSchema.optional(),
  /** Etkinleştirmede tüketilen kodun türü (bilgi; tanınmayan değer yok sayılır). */
  kodTuru: z.enum(ACTIVATION_CODE_KINDS).optional().catch(undefined),
  /** Güncel iptal belgesi (`tekserp-iptal`, G4) — ayrıca doğrulanır; biçimsizse yok sayılır, kirayı düşürmez. */
  iptal: JwsTextSchema.optional().catch(undefined),
  /** Güncel PAKET sertifikası iptal listesi (`tekserp-paketiptal`) — ayrıca kökle doğrulanır; biçimsizse yok sayılır. */
  paketIptal: JwsTextSchema.optional().catch(undefined),

  /** İstek bağı (`tekserp-yanit`, 6.3c): canlı yanıtta kirayı isteğin nonce'una bağlar; eski satıcı göndermez. */
  yanitBagi: JwsTextSchema.optional(),
});

/**
 * Taşıma talebi yanıtı. Talep kod ya da lisans TAŞIMAZ: satıcı `lisans`ı null döner (alan v:1 uyumu için
 * kalır); taşıma kodu müşteriye portal üzerinden iletilir, bu yanıtta asla dönmez.
 */
export const TransferResponseSchema = z.object({
  v: VersionField,
  talepId: UuidSchema,
  durum: z.enum(["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"]),
  lisans: LicenseResponseSchema.nullable(),
});

/** Satıcının `details.code` değerleri (protokol doğrulama kodları da aynen dönebilir). */
export const VENDOR_ERROR_CODES = [
  "GOVDE_GECERSIZ",
  "PROTOKOL_SURUMU",
  "ISTEK_GECERSIZ",
  "ISTEK_TEKRAR",
  "KURULUM_BILINMIYOR",
  "KURULUM_IPTAL",
  "ETKINLESTIRME_KODU_GECERSIZ",
  "ETKINLESTIRME_KODU_KULLANILMIS",
  "TASIMA_ONAYI_BEKLIYOR",
  /** 409: kurulum başka bir anahtarla ETKİN — yeni makine yalnız onaylı taşıma koduyla etkinleşir (ilk kod yetmez). */
  "TASIMA_KODU_GEREKLI",
  "KIRA_VERILMEDI",
  /** 409: DR devralımında ana kurulum verilmedi ve tesiste tek etkin ÜRETİM kurulumu yok (0 ya da birden çok). */
  "DR_ANA_BELIRSIZ",
  /** 409: etkinleştirme geçerli bir ilk kurulum kabul belgesi taşımıyor (Ek-7 §5) — `details.neden` ∈ ACCEPTANCE_REJECTIONS. */
  "KABUL_GEREKLI",
  "HIZ_SINIRI",
  /** 409: eşzamanlı işlem çakıştı (40001/40P01, atomik claim kaybı) — aynı istek yeniden denenebilir. */
  "TEKRAR_DENEYIN",
  /** 404: satıcıda böyle bir yol yok (adres yanlış ya da sunucu sürümü eski). */
  "BULUNAMADI",
  /** 409: etkinleştirmede okunabilen etken < 3 ya da güçlü < 2 (K8) — portal onayı bekler; kod ve nonce tüketilmez. */
  "ZAYIF_TANIMA_ONAY_BEKLIYOR",
  "SUNUCU_HATASI",
] as const;
export type VendorErrorCode = (typeof VENDOR_ERROR_CODES)[number];

export const VendorErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  details: z.object({
    code: z.string(),
    /**
     * `ISTEK_ZAMAN`da satıcının saati. İMZASIZDIR: yalnız isteği BİR KEZ yeniden damgalamaya yarar;
     * güvenilir saate, yüksek suya, ek süreye girmez. Biçimsizse yok sayılır (kod yine okunur).
     */
    sunucuSaati: IsoTimeSchema.optional().catch(undefined),
  }),
});

export type ActivateRequest = z.infer<typeof ActivateRequestSchema>;
export type PollRequest = z.infer<typeof PollRequestSchema>;
export type LicenseResponse = z.infer<typeof LicenseResponseSchema>;
export type HealthSummary = z.infer<typeof HealthSummarySchema>;

// ── Destek talebi (3d-2) ──────────────────────────────────────────────────────
export const SUPPORT_SUBJECT_MAX = 200;
export const SUPPORT_TEXT_MAX = 5000;
/** Küçük ek (ekran görüntüsü) üst sınırı — ikili bayt; büyük ek `/y/<belirteç>` yükleme bağlantısıyla gider. */
export const SUPPORT_ATTACHMENT_MAX_BYTES = 1024 * 1024;
export const SUPPORT_ATTACHMENT_TYPES = ["image/png", "image/jpeg"] as const;
/** Satıcıdaki talep durumu; fabrikanın yerel kopyası bunun aynasıdır (+ yerel `GONDERILMEDI`). */
export const SUPPORT_TICKET_STATES = ["ACIK", "YANITLANDI", "KAPANDI"] as const;
export type SupportTicketState = (typeof SUPPORT_TICKET_STATES)[number];
const Base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(Math.ceil(SUPPORT_ATTACHMENT_MAX_BYTES / 3) * 4);

/** `POST /v1/destek` (amaç `destek`) — `talepId` fabrikanın yerel talep kimliğidir: tekrar gönderim aynı talebi döner. */
export const SupportRequestSchema = z.strictObject({
  v: VersionField,
  talepId: UuidSchema,
  konu: z.string().trim().min(1).max(SUPPORT_SUBJECT_MAX),
  aciklama: z.string().trim().min(1).max(SUPPORT_TEXT_MAX),
  acan: z.string().trim().min(1).max(120).nullable(),
  panelSurum: VersionTextSchema.nullable(),
  ek: z.strictObject({ tur: z.enum(SUPPORT_ATTACHMENT_TYPES), veri: Base64Schema }).nullable(),
  saglik: HealthSummarySchema,
  ortam: EnvironmentSchema,
});
export type SupportRequest = z.infer<typeof SupportRequestSchema>;

export const SupportResponseSchema = z.object({
  v: VersionField,
  talepId: UuidSchema,
  talepNo: z.string().min(1).max(40),
  durum: z.enum(SUPPORT_TICKET_STATES),
});

/** Yoklama YANITINDAKİ destek güncellemesi (gevşek): kurulumun son 30 günde hareketli talepleri + satıcı yanıtları. */
export const SUPPORT_UPDATE_LIMIT = 20;
export const SUPPORT_REPLY_LIMIT = 50;
export const SupportTicketUpdateSchema = z.object({
  talepId: UuidSchema,
  talepNo: z.string().min(1).max(40),
  durum: z.enum(SUPPORT_TICKET_STATES),
  guncellendi: IsoTimeSchema,
  yanitlar: z
    .array(z.object({ yanitId: UuidSchema, metin: z.string().min(1).max(SUPPORT_TEXT_MAX), zaman: IsoTimeSchema }))
    .max(SUPPORT_REPLY_LIMIT),
});
export type SupportTicketUpdate = z.infer<typeof SupportTicketUpdateSchema>;
/** Yanıttan destek alanını okur; biçimsiz alan kirayı DÜŞÜRMEZ (yok sayılır). */
export const SupportUpdateListSchema = z.array(SupportTicketUpdateSchema).max(SUPPORT_UPDATE_LIMIT);
export function readSupportUpdates(raw: unknown): SupportTicketUpdate[] {
  if (!isPlainObject(raw)) return [];
  const parsed = SupportUpdateListSchema.safeParse(raw["destek"]);
  return parsed.success ? parsed.data : [];
}
