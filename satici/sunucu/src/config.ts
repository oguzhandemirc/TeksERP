// Satıcı sunucusu yapılandırması — ortamdan okunur, Zod ile doğrulanır; geçersiz değer
// açılışı DURDURUR (fail-closed). Sır (parola, özel anahtar) buradan GEÇMEZ: kök parolası
// yalnız imza anında imza alt sürecinin stdin'ine gider.
import { isIPv4, isIPv6 } from "node:net";
import path from "node:path";
import { z } from "zod";

const port = z.coerce.number().int().min(0).max(65535);

/** Virgülle ayrılmış CIDR listesi (ör. "173.245.48.0/20, 2400:cb00::/32"); biçimsiz öğe açılışı durdurur. */
const cidrList = z
  .string()
  .transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean))
  .refine((list) => list.every(isCidr), "CIDR listesi biçimsiz (ör. 10.0.0.0/8, fd00::/8)");

function isCidr(text: string): boolean {
  const [net, bits, extra] = text.split("/");
  if (extra !== undefined || !net || bits === undefined || !/^\d{1,3}$/.test(bits)) return false;
  const n = Number(bits);
  if (isIPv4(net)) return n <= 32;
  if (isIPv6(net)) return n <= 128;
  return false;
}
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
  /** Derlenmiş web arayüzü (`satici/web` → `dist/portal` · `dist/bayi`); yoksa arayüz 404, API çalışır. */
  PORTAL_WEB_DIZINI: z.string().min(1).default("../web/dist"),
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
  /** /v1/* hız sınırı (dakikalık, sabit pencere): istemci IP'si başına ve kurulum (ya da kurulumsuz anahtar) başına. */
  V1_HIZ_IP_DK: positiveInt(1, 100_000).default(120),
  V1_HIZ_KURULUM_DK: positiveInt(1, 100_000).default(30),
  /** Kapı zili: kurulum başına eşzamanlı SSE aboneliği tavanı (aşan yeni abonelik en eskisini kapatır). */
  ZIL_AZAMI_ABONE: positiveInt(1, 10).default(3),
  /** Vekil arkasında istemci IP'sini taşıyan başlık (ör. cf-connecting-ip); boşsa soket adresi. */
  VEKIL_IP_BASLIGI: z.string().min(1).optional(),
  /**
   * Başlığa GÜVENİLEN kenar vekili ağları (CIDR listesi, virgülle): yalnız bu ağlardan gelen bağlantıda
   * VEKIL_IP_BASLIGI okunur. Verilmezse yerleşik Cloudflare aralıkları.
   */
  GUVENILIR_VEKIL_AGLARI: cidrList.optional(),
  /**
   * Kenar vekili ile satıcı arasındaki İÇ vekiller (ör. Traefik'in köprü ağı). Bu ağlardan gelen bağlantıda
   * güven kararı X-Forwarded-For'un SON halkasına (iç vekilin gördüğü adres) göre verilir. Boş = iç vekil yok.
   */
  IC_VEKIL_AGLARI: cidrList.default([]),
  /** Geri döngü (127.0.0.0/8 · ::1) yalnız "1" iken tailnet kaynağı sayılır (Tailscale kurulana dek SSH tüneli için). */
  TAILNET_LOOPBACK: z.enum(["0", "1"]).default("0"),
  /** İmza parolası (kök/bayi): kullanıcı başına ardışık hata eşiği ve kilit süresi (dk). */
  IMZA_PAROLA_ESIGI: positiveInt(3, 50).default(5),
  IMZA_KILIT_DK: positiveInt(1, 24 * 60).default(15),
  /** İmza alt süreci (scrypt belleği ağır) eşzamanlılık slotu. */
  IMZA_ESZAMANLI: positiveInt(1, 2).default(1),
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
  /** Denetim budaması (günlük; denetim defter değil ayak izidir): başarısız giriş satırları ve diğer denetim (gün). */
  DENETIM_GIRIS_SAKLAMA_GUN: positiveInt(30, 3650).default(90),
  DENETIM_SAKLAMA_GUN: positiveInt(365, 3650).default(730),
  /** Tailnet çerezine Secure: yalnız tailnet dinleyicisi HTTPS arkasındaysa "1" (genel dinleyicide her zaman Secure). */
  TAILNET_CEREZ_GUVENLI: z.enum(["0", "1"]).default("0"),
  /** İÇ API dinleyicisi (patron bulutu → satıcı, `/ic/v1/*`): docker iç ağındaki kendi adresi ya da geri döngü. */
  PORT_IC: port.default(4612),
  IC_BIND: z
    .string()
    .default("127.0.0.1")
    .refine((v) => !WILDCARD_ADDRESSES.has(v.trim()), "IC_BIND joker adres olamaz (0.0.0.0 / ::)"),
  /** İç API'ye bağlanabilecek KAYNAK ağlar (soket adresi; başlık okunmaz). Verilmezse yalnız geri döngü. */
  IC_KAYNAK_AGLARI: cidrList.optional(),
  /** İç API ortak sırrının (Bearer) dosyası; yoksa, okunamazsa ya da zayıfsa iç API AÇILMAZ. */
  IC_API_BELIRTEC_DOSYASI: z.string().min(1).optional(),
  /** İç zil: tesis başına dakikalık tavan. */
  IC_ZIL_HIZ_DK: positiveInt(1, 1000).default(12),
  /** İç API çağrı sayacının denetime yazılma aralığı (dk; her istek değil, pencere başına tek satır). */
  IC_SAYAC_DK: positiveInt(1, 24 * 60).default(60),
  // ---- Dağıtım (Faz 3d) ----
  /** Paylaşılan dosya gövdeleri + yarım yükleme parçaları (satıcının kendi birimi; yerelde fikstür dizini). */
  DOSYA_DIZINI: z.string().min(1).default("dosyalar"),
  /** İlk kurulum derlemeleri (müşteri başına filigranlı derleme buraya konur; yalnız OKUNUR). */
  DERLEME_DIZINI: z.string().min(1).default("derlemeler"),
  /** Güncelleme sunucusunun yayın kökü (html/ + defter/) — SALT-OKUNUR bağ; verilmezse görünüm "ölçülemedi". */
  YAYIN_DIZINI: z.string().min(1).optional(),
  /** Parça tavanı (MB): Cloudflare ücretsiz planda istek gövdesi ≤ 100 MB → varsayılan 50. */
  PARCA_AZAMI_MB: positiveInt(1, 95).default(50),
  /** Tek dosya tavanı (MB) — yükleme isteğinin azamisi bunu aşamaz. */
  DOSYA_AZAMI_MB: positiveInt(1, 20_480).default(4096),
  /** Paylaşılan dosyanın gövde saklama süresi (gün); dolunca gövde budanır, satır KALIR. */
  DOSYA_SAKLAMA_GUN: positiveInt(1, 3650).default(30),
  /** Bu kadar saat parça gelmeyen açık yükleme oturumu terk sayılır (parçalar silinir, kota iade). */
  YUKLEME_TERK_SAAT: positiveInt(1, 24 * 30).default(48),
  /** Genel dinleyicinin dışarıdan görünen kökü (ör. https://lisans.ornek.com) — portal /d · /y bağlantısını TAM adresle verir. */
  GENEL_KOK_ADRESI: z.url({ protocol: /^https?$/ }).optional(),
  /** /d · /y · /yayin/bildirim istemci IP'si başına dakikalık sınır. */
  DAGITIM_HIZ_IP_DK: positiveInt(1, 100_000).default(120),
});

export type VendorConfig = Readonly<
  Omit<
    z.infer<typeof EnvSchema>,
    "ANAHTAR_DIZINI" | "GUVEN_CAPASI_DOSYASI" | "PORTAL_WEB_DIZINI" | "IC_API_BELIRTEC_DOSYASI" | "DOSYA_DIZINI" | "DERLEME_DIZINI" | "YAYIN_DIZINI"
  > & {
    ANAHTAR_DIZINI: string;
    PORTAL_WEB_DIZINI: string;
    GUVEN_CAPASI_DOSYASI: string | undefined;
    IC_API_BELIRTEC_DOSYASI: string | undefined;
    DOSYA_DIZINI: string;
    DERLEME_DIZINI: string;
    YAYIN_DIZINI: string | undefined;
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
    PORTAL_WEB_DIZINI: path.resolve(cwd, c.PORTAL_WEB_DIZINI),
    GUVEN_CAPASI_DOSYASI: c.GUVEN_CAPASI_DOSYASI ? path.resolve(cwd, c.GUVEN_CAPASI_DOSYASI) : undefined,
    IC_API_BELIRTEC_DOSYASI: c.IC_API_BELIRTEC_DOSYASI ? path.resolve(cwd, c.IC_API_BELIRTEC_DOSYASI) : undefined,
    DOSYA_DIZINI: path.resolve(cwd, c.DOSYA_DIZINI),
    DERLEME_DIZINI: path.resolve(cwd, c.DERLEME_DIZINI),
    YAYIN_DIZINI: c.YAYIN_DIZINI ? path.resolve(cwd, c.YAYIN_DIZINI) : undefined,
  });
}
