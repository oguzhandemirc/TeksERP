// Patron bulutu yapılandırması — ortamdan okunur, Zod ile doğrulanır; geçersiz değer açılışı
// DURDURUR (fail-closed). Üç DB URL'i üç ayrı roldür: göç (tablo sahibi; yalnız migration/CLI),
// uygulama (hesap API'si; projeksiyona YAZAMAZ) ve eşitleme (fabrika kanalı). Sır (iç API belirteci,
// DB parolaları) günlüğe yazılmaz.
import path from "node:path";
import { z } from "zod";

const port = z.coerce.number().int().min(0).max(65535);
const positiveInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const EnvSchema = z
  .object({
    /** Uygulama rolü (NOSUPERUSER NOBYPASSRLS) — hesap API'si. */
    DATABASE_URL: z.string().min(1),
    /** Eşitleme rolü (NOSUPERUSER NOBYPASSRLS) — fabrika kanalı + bakım budaması. */
    ESITLEME_DATABASE_URL: z.string().min(1),
    PORT: port.default(4620),
    BIND: z.string().min(1).default("127.0.0.1"),
    /** TOTP sırlarının sarma anahtarı burada (`patron-totp.key`, 0600) — DB'de DEĞİL. */
    ANAHTAR_DIZINI: z.string().min(1).default("anahtarlar"),
    /** Web sürümünün derlenmiş çıktısı (`expo export --platform web`); verilirse `/` altında sunulur, yoksa yalnız API. */
    PATRON_WEB_DIZINI: z.string().min(1).optional(),
    /** Kurulum kaydının kaynağı: `kayit` (satıcı CLI'siyle DB'ye yazılmış) · `satici` (iç API + önbellek). */
    KURULUM_KAYNAGI: z.enum(["kayit", "satici"]).default("kayit"),
    SATICI_IC_API_URL: z.url().optional(),
    SATICI_IC_API_BELIRTECI: z.string().min(32).optional(),
    /** Satıcı iç API önbelleğinin TAZELİK süresi; süre dolunca yeniden sorulur, ulaşılamazsa bayat kayıt kullanılır. */
    KURULUM_ONBELLEK_DK: positiveInt(1, 1440).default(5),
    VEKIL_IP_BASLIGI: z.string().min(1).optional(),
    /** Oturum: boşta kalma (saat) ve mutlak ömür (gün) — patron uygulaması telefonda uzun oturum ister. */
    OTURUM_BOSTA_SAAT: positiveInt(1, 720).default(168),
    OTURUM_AZAMI_GUN: positiveInt(1, 90).default(30),
    GIRIS_ESIGI: positiveInt(3, 50).default(5),
    KILIT_DK: positiveInt(1, 1440).default(15),
    GIRIS_HIZ_DK: positiveInt(1, 1000).default(20),
    DAVET_GECERLILIK_SAAT: positiveInt(1, 720).default(72),
    /** Fabrika kanalı (/v1/*) IP başına dakikalık hız sınırı. */
    V1_HIZ_DK: positiveInt(10, 100000).default(600),
    GELEN_KUTUSU_CLAIM_DK: positiveInt(1, 60).default(10),
    RAPOR_CLAIM_DK: positiveInt(1, 60).default(5),
    BAKIM_ARALIGI_SN: positiveInt(1, 3600).default(60),
    OTURUM_SAKLAMA_GUN: positiveInt(1, 3650).default(30),
    ISLEM_SAKLAMA_GUN: positiveInt(1, 3650).default(30),
    PAKET_SAKLAMA_GUN: positiveInt(1, 3650).default(30),
    RAPOR_SONUC_SAKLAMA_GUN: positiveInt(1, 3650).default(30),
    DENETIM_GIRIS_SAKLAMA_GUN: positiveInt(30, 3650).default(90),
    DENETIM_SAKLAMA_GUN: positiveInt(365, 3650).default(730),
    /** Bildirim gönderimi: `kapali` (varsayılan — bugünkü davranış, hiçbir şey üretilmez/gönderilmez) · `sahte`
     *  (kayıtlı sahte gönderici; yerel/prova) · `gercek` (Expo push + web push). */
    BILDIRIM_KIPI: z.enum(["kapali", "sahte", "gercek"]).default("kapali"),
    BILDIRIM_ARALIGI_SN: positiveInt(5, 3600).default(30),
    /** Sonuçlanmış bildirim satırı bu kadar gün sonra budanır (telemetri). */
    BILDIRIM_SAKLAMA_GUN: positiveInt(7, 3650).default(90),
    /** Web push VAPID `sub` (mailto: ya da https:) — `gercek` kipte zorunlu. Anahtar çifti ANAHTAR_DIZINI'nde. */
    // Boş değer = verilmedi: compose `${BILDIRIM_VAPID_KONU:-}` ile her zaman geçirir (kapali kipte boş kalır).
    BILDIRIM_VAPID_KONU: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^(mailto:|https:\/\/)\S+$/).optional()),
    EXPO_PUSH_URL: z.url().default("https://exp.host/--/api/v2/push/send"),
    EXPO_MAKBUZ_URL: z.url().default("https://exp.host/--/api/v2/push/getReceipts"),
    /** Expo erişim belirteci (isteğe bağlı "enhanced push security") — SIRdır, günlüğe yazılmaz. */
    EXPO_ERISIM_BELIRTECI: z.string().min(16).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.BILDIRIM_KIPI === "gercek" && !c.BILDIRIM_VAPID_KONU) {
      ctx.addIssue({ code: "custom", message: "BILDIRIM_KIPI=gercek için BILDIRIM_VAPID_KONU zorunlu", path: ["BILDIRIM_VAPID_KONU"] });
    }
    if (c.KURULUM_KAYNAGI === "satici" && (!c.SATICI_IC_API_URL || !c.SATICI_IC_API_BELIRTECI)) {
      ctx.addIssue({ code: "custom", message: "KURULUM_KAYNAGI=satici için SATICI_IC_API_URL ve SATICI_IC_API_BELIRTECI zorunlu", path: ["KURULUM_KAYNAGI"] });
    }
  });

export type CloudConfig = Readonly<z.infer<typeof EnvSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): CloudConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Patron bulutu yapılandırması geçersiz — ${issues}`);
  }
  const web = parsed.data.PATRON_WEB_DIZINI;
  return Object.freeze({ ...parsed.data, ANAHTAR_DIZINI: path.resolve(cwd, parsed.data.ANAHTAR_DIZINI), PATRON_WEB_DIZINI: web ? path.resolve(cwd, web) : undefined });
}
