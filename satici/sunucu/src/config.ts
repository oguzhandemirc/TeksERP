// Satıcı sunucusu yapılandırması — ortamdan okunur, Zod ile doğrulanır; geçersiz değer
// açılışı DURDURUR (fail-closed). Sır (parola, özel anahtar) buradan GEÇMEZ: kök parolası
// yalnız imza anında imza alt sürecinin stdin'ine gider.
import path from "node:path";
import { z } from "zod";

const port = z.coerce.number().int().min(0).max(65535);
const positiveInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/** Tailnet dinleyicisi joker adrese bağlanamaz: portal internete açılmasın. */
const WILDCARD_ADDRESSES = new Set(["0.0.0.0", "::", "[::]", "*", ""]);

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT_GENEL: port.default(4610),
  GENEL_BIND: z.string().min(1).default("127.0.0.1"),
  TAILNET_BIND: z
    .string()
    .default("127.0.0.1")
    .refine((v) => !WILDCARD_ADDRESSES.has(v.trim()), "TAILNET_BIND joker adres olamaz (0.0.0.0 / ::)"),
  PORT_TAILNET: port.default(4611),
  ANAHTAR_DIZINI: z.string().min(1).default("anahtarlar"),
  /** Yalnız hazırlık/test: gömülü çapa (ROOT_PUBLIC_KEYS) yerine bu dosyadaki kökler. */
  GUVEN_CAPASI_DOSYASI: z.string().min(1).optional(),
  KIRA_GUN: positiveInt(1, 45).default(30),
  EK_SURE_GUN: positiveInt(0, 60).default(30),
  INDIRME_OMUR_DK: positiveInt(1, 70).default(60),
  ZIL_KALP_SN: positiveInt(1, 120).default(25),
  /** Kopya şüphesinin ilk (yalnız uyarı) penceresi. */
  KOPYA_PENCERE_SN: positiveInt(1, 30 * 86400).default(86400),
  /** Aynı ucun ağ tekrarı: bu süre içinde aynı çocuk kira döner. */
  TEKRAR_PENCERE_SN: positiveInt(1, 3600).default(900),
  /** Pencere içinde bu kadar "yakala" = ayırt edilemeyen kopya uyarısı. */
  YAKALA_UYARI_ESIGI: positiveInt(2, 100).default(3),
  YOKLAMA_SAKLAMA_GUN: positiveInt(1, 3650).default(90),
  BAKIM_ARALIGI_SN: positiveInt(1, 3600).default(60),
  ETKINLESTIRME_KODU_GUN: positiveInt(1, 365).default(30),
  QR_HIZ_SINIRI_DK: positiveInt(1, 10000).default(30),
  /** Vekil arkasında istemci IP'sini taşıyan başlık (ör. cf-connecting-ip); boşsa soket adresi. */
  VEKIL_IP_BASLIGI: z.string().min(1).optional(),
  /** Portal oturumu: boşta kalma (dk) ve mutlak ömür (saat). */
  PORTAL_OTURUM_BOSTA_DK: positiveInt(1, 24 * 60).default(30),
  PORTAL_OTURUM_AZAMI_SAAT: positiveInt(1, 72).default(12),
  /** Ardışık başarısız girişte hesap kilidi: eşik ve süre (dk). */
  PORTAL_GIRIS_ESIGI: positiveInt(3, 50).default(5),
  PORTAL_KILIT_DK: positiveInt(1, 24 * 60).default(15),
  /** Giriş ucunun IP başına dakikalık hız sınırı (iki dinleyicide ayrı sayılır). */
  PORTAL_GIRIS_HIZ_DK: positiveInt(1, 1000).default(20),
  /** Budama: kapanmış/bitmiş oturum ve işlem kimliği satırlarının saklama süresi (gün). */
  PORTAL_OTURUM_SAKLAMA_GUN: positiveInt(1, 3650).default(30),
  PORTAL_ISLEM_SAKLAMA_GUN: positiveInt(1, 3650).default(30),
  /** Tailnet çerezine Secure: yalnız tailnet dinleyicisi HTTPS arkasındaysa "1" (genel dinleyicide her zaman Secure). */
  TAILNET_CEREZ_GUVENLI: z.enum(["0", "1"]).default("0"),
});

export type VendorConfig = Readonly<
  Omit<z.infer<typeof EnvSchema>, "ANAHTAR_DIZINI" | "GUVEN_CAPASI_DOSYASI"> & {
    ANAHTAR_DIZINI: string;
    GUVEN_CAPASI_DOSYASI: string | undefined;
  }
>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): VendorConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Satıcı yapılandırması geçersiz — ${issues}`);
  }
  const c = parsed.data;
  return Object.freeze({
    ...c,
    ANAHTAR_DIZINI: path.resolve(cwd, c.ANAHTAR_DIZINI),
    GUVEN_CAPASI_DOSYASI: c.GUVEN_CAPASI_DOSYASI ? path.resolve(cwd, c.GUVEN_CAPASI_DOSYASI) : undefined,
  });
}
