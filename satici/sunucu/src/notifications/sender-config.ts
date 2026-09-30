// GÖNDERİCİ YAPILANDIRMASI (yan konteyner `satici-bildirim`) — ortamdan; bot belirteci, Telegram sohbet kimliği ve
// Resend anahtarı ortamdan YA DA dosyadan (docker secret: `…_DOSYASI`; dağıtımda DOSYA — değer koda/runbook'a gömülmez). Biçimsiz genel ayar açılışı durdurur (fail-closed); bir KANALIN eksik/okunamayan/biçimsiz
// sırrı yalnız o kanalı KAPALI yapar (diğer kanal çalışır): gönderim yok, nabız ve günlük "kanal yapılandırılmamış"
// der, gerekçe yalnız DEĞİŞKEN ADINI taşır — sırrın kendisi hiçbir iletiye girmez. `.env` OKUNMAZ (yerelde satıcının
// sahip URL'i sızmasın): gönderici yalnız kendi ortamıyla ve yalnız kendi DB rolüyle koşar.
import { readFileSync, statSync } from "node:fs";
import type { BildirimKanali } from "@prisma/client";
import { z } from "zod";
import { CHAT_ID_PATTERN, type ResendSettings, type TelegramSettings } from "./transports";

const positiveInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/** Sağlayıcı kökü: https — yalnız geri döngü (yerel sahte sunucu, bekçi) düz http olabilir. */
const apiRoot = z
  .url({ protocol: /^https?$/ })
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  }, "Sağlayıcı kökü https olmalı (düz http yalnız geri döngü)")
  .transform((v) => v.replace(/\/+$/, ""));

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/;
const emailList = z
  .string()
  .transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean))
  .refine((list) => list.length > 0 && list.length <= 10 && list.every((x) => EMAIL.test(x)), "E-posta alıcı listesi biçimsiz (virgüllü adres, en çok 10)");
/** Gönderen: `adres` ya da `Ad <adres>` (Resend biçimi). */
const sender = z.string().trim().refine((v) => EMAIL.test(v) || /^[^<>]{1,80} <[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}>$/.test(v), "Gönderen biçimsiz (adres ya da `Ad <adres>`)");

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_TOKEN_DOSYASI: z.string().min(1).optional(),
  /** Sohbet (grup) kimliği — dağıtımda DOSYADAN (`…_DOSYASI`, docker secret); doğrudan değer yalnız yerel/bekçi. */
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_CHAT_ID_DOSYASI: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_API_KEY_DOSYASI: z.string().min(1).optional(),
  BILDIRIM_EPOSTA_ALICI: emailList.optional(),
  BILDIRIM_EPOSTA_GONDEREN: sender.optional(),
  /** Portal kökü (tailnet): ör. http://tekserp-vds:4611/portal — bildirimdeki bağlantı buna göreli yol ekler. */
  BILDIRIM_PORTAL_ADRESI: z.url({ protocol: /^https?$/ }).transform((v) => v.replace(/\/+$/, "")).optional(),
  TELEGRAM_API_KOKU: apiRoot.default("https://api.telegram.org"),
  RESEND_API_KOKU: apiRoot.default("https://api.resend.com"),
  BILDIRIM_DONGU_SN: positiveInt(1, 3600).default(15),
  BILDIRIM_DENEME_TAVANI: positiveInt(1, 20).default(6),
  BILDIRIM_AZAMI_YAS_SAAT: positiveInt(1, 24 * 30).default(72),
  BILDIRIM_NABIZ_DOSYASI: z.string().min(1).default("/tmp/satici-bildirim.nabiz"),
  BILDIRIM_SAAT_DILIMI: z
    .string()
    .default("Europe/Istanbul")
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("tr-TR", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "BILDIRIM_SAAT_DILIMI tanınmayan saat dilimi"),
});

type Env = z.infer<typeof EnvSchema>;

export type ChannelState<T> = { readonly ok: true; readonly settings: T } | { readonly ok: false; readonly reason: string };

export interface SenderConfig {
  readonly databaseUrl: string;
  readonly telegram: ChannelState<TelegramSettings>;
  readonly email: ChannelState<ResendSettings>;
  readonly portalBase: string | null;
  readonly loopSeconds: number;
  readonly maxAttempts: number;
  readonly maxAgeHours: number;
  readonly heartbeatFile: string;
  readonly timeZone: string;
}

const TELEGRAM_TOKEN = /^\d{5,20}:[A-Za-z0-9_-]{30,64}$/;
const RESEND_KEY = /^re_[A-Za-z0-9_]{16,128}$/;

/**
 * Sır: ortamdan ya da dosyadan (ikisi birden → belirsiz, kanal kapalı). Dosya okunamaz ya da HERKESE açıksa (o+r)
 * kanal kapalı; boş dosya = kanal bilerek kapalı. Dönen gerekçe yalnız değişken adını taşır.
 */
function secret(env: Env, name: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_CHAT_ID" | "RESEND_API_KEY"): { value: string } | { reason: string } {
  const direct = env[name]?.trim() || undefined;
  const file = env[`${name}_DOSYASI`];
  if (direct && file) return { reason: `${name} ve ${name}_DOSYASI birlikte verilmiş (belirsiz)` };
  if (direct) return { value: direct };
  if (!file) return { reason: `${name} yok` };
  try {
    if ((statSync(file).mode & 0o004) !== 0) return { reason: `${name}_DOSYASI herkese okunur (0440/0400 olmalı)` };
    const value = readFileSync(file, "utf8").trim();
    return value ? { value } : { reason: `${name}_DOSYASI boş` };
  } catch {
    return { reason: `${name}_DOSYASI okunamadı` };
  }
}

function telegramState(env: Env): ChannelState<TelegramSettings> {
  const token = secret(env, "TELEGRAM_BOT_TOKEN");
  const chat = secret(env, "TELEGRAM_CHAT_ID");
  const missing = [...("reason" in token ? [token.reason] : []), ...("reason" in chat ? [chat.reason] : [])];
  if (missing.length > 0 || !("value" in token) || !("value" in chat)) return { ok: false, reason: missing.join("; ") };
  if (!TELEGRAM_TOKEN.test(token.value)) return { ok: false, reason: "TELEGRAM_BOT_TOKEN biçimsiz" };
  if (!CHAT_ID_PATTERN.test(chat.value)) return { ok: false, reason: "TELEGRAM_CHAT_ID biçimsiz (işaretli tam sayı: grup -<sayı>, süper grup -100<sayı>)" };
  return { ok: true, settings: { apiRoot: env.TELEGRAM_API_KOKU, token: token.value, chatId: chat.value } };
}

function emailState(env: Env): ChannelState<ResendSettings> {
  const key = secret(env, "RESEND_API_KEY");
  const missing = [
    ...("reason" in key ? [key.reason] : []),
    ...(env.BILDIRIM_EPOSTA_ALICI ? [] : ["BILDIRIM_EPOSTA_ALICI yok"]),
    ...(env.BILDIRIM_EPOSTA_GONDEREN ? [] : ["BILDIRIM_EPOSTA_GONDEREN yok"]),
  ];
  if (missing.length > 0 || !("value" in key)) return { ok: false, reason: missing.join("; ") };
  if (!RESEND_KEY.test(key.value)) return { ok: false, reason: "RESEND_API_KEY biçimsiz" };
  return { ok: true, settings: { apiRoot: env.RESEND_API_KOKU, apiKey: key.value, from: env.BILDIRIM_EPOSTA_GONDEREN!, to: env.BILDIRIM_EPOSTA_ALICI! } };
}

export function loadSenderConfig(raw: NodeJS.ProcessEnv): SenderConfig {
  // Compose tanımsız değişkeni BOŞ metin olarak geçirir (`${X:-}`): boş = verilmemiş (kanal kapalı, varsayılan geçerli).
  const present = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Bildirim gönderici yapılandırması geçersiz — ${issues}`);
  }
  const env = parsed.data;
  return {
    databaseUrl: env.DATABASE_URL,
    telegram: telegramState(env),
    email: emailState(env),
    portalBase: env.BILDIRIM_PORTAL_ADRESI ?? null,
    loopSeconds: env.BILDIRIM_DONGU_SN,
    maxAttempts: env.BILDIRIM_DENEME_TAVANI,
    maxAgeHours: env.BILDIRIM_AZAMI_YAS_SAAT,
    heartbeatFile: env.BILDIRIM_NABIZ_DOSYASI,
    timeZone: env.BILDIRIM_SAAT_DILIMI,
  };
}

/** Kanal → nabız/günlük metni (sır YOK). Telegram sohbeti taşındıysa yeni kimlik (yalnız sayı) ve yapılacak iş yazılır. */
export function channelSummary(cfg: SenderConfig, runtime: { telegramMigratedTo?: string | null } = {}): Record<BildirimKanali, string> {
  const s = (st: ChannelState<unknown>) => (st.ok ? "hazır" : `kanal yapılandırılmamış (${st.reason}) — gönderim KAPALI`);
  const moved =
    runtime.telegramMigratedTo === undefined
      ? null
      : `sohbet süper gruba taşındı — yeni sohbet kimliği ${runtime.telegramMigratedTo ?? "(okunamadı)"}: sohbet kimliği dosyasını güncelleyip göndericiyi yeniden başlatın (gönderim HATA)`;
  return { EPOSTA: s(cfg.email), TELEGRAM: moved ?? s(cfg.telegram) };
}
