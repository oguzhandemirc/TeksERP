// GÜVENLİK OLAYLARI (B3, patron) — süreç içi tek sayaç + AYRI güvenlik Telegram sohbetine doğrudan teslim (patron dışarı
// bağlanır; satıcının giden kutusu yoktur burada). Olay yerinde yalnız `securityEvent(sınıf, kod)` (senkron, atmaz);
// eşik + birleştirme penceresi + günlük özet çekirdekte (`guvenlik-alarm.ts`, satıcıyla BAYT-EŞİT). Belirteç ya da
// sohbet kimliği yoksa kanal KAPALI: olay yalnız sayılır, açılışta "güvenlik bildirimi: KAPALI" uyarısı. E-posta YOK.
import { readFileSync, statSync } from "node:fs";
import { GuvenlikAlarmi, type AlarmIletisi, type GunlukOzet } from "./guvenlik-alarm";

export const SECURITY_CLASSES = ["IMZA_RED", "HAK_RED", "GIRIS_KILIT", "HIZ_SINIRI", "SIR_DOSYASI_RED"] as const;
export type SecurityClass = (typeof SECURITY_CLASSES)[number];

export const SECURITY_CLASS_LABELS: Readonly<Record<SecurityClass, string>> = {
  IMZA_RED: "Fabrika kanalı imza/kurulum reddi (401)",
  HAK_RED: "Patron bulutu hakkı reddi (403)",
  GIRIS_KILIT: "Hesap girişi kilitlendi (hesap + adres)",
  HIZ_SINIRI: "Hız sınırı aşıldı",
  SIR_DOSYASI_RED: "Sır dosyası izni güvensiz — açılış reddedildi",
};

export const SECURITY_THRESHOLDS: Readonly<Record<SecurityClass, number>> = { IMZA_RED: 10, HAK_RED: 5, GIRIS_KILIT: 1, HIZ_SINIRI: 3, SIR_DOSYASI_RED: 1 };
export const SECURITY_WINDOW_MS = 5 * 60_000;
const TICK_MS = 30_000;
const CODE = /^[A-Z0-9_]{1,40}$/;
const TOKEN = /^\d{5,20}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID = /^-?\d{1,20}$/;

export type SecurityMessage = { kind: "alarm"; alarm: AlarmIletisi } | { kind: "ozet"; ozet: GunlukOzet };
export type SecuritySend = (text: string) => Promise<boolean>;
export type ChannelState = { readonly ok: true; readonly send: SecuritySend } | { readonly ok: false; readonly reason: string };

let alarm = new GuvenlikAlarmi({ esikDk: SECURITY_THRESHOLDS, pencereMs: SECURITY_WINDOW_MS }, Date.now());
let sender: SecuritySend | null = null;
let failures = 0;
let sent = 0;

const htmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** İleti metni (Telegram HTML): yalnız sınıf, sayı, kısa kod — adres, e-posta, kurulum kimliği GİRMEZ. */
export function renderSecurityMessage(m: SecurityMessage): string {
  if (m.kind === "ozet") {
    const parts = SECURITY_CLASSES.map((c) => `${c} ${m.ozet.sayac[c] ?? 0}`);
    return [`<b>Günlük güvenlik özeti — patron bulutu</b>`, `Son 24 saat (sayım ${new Date(m.ozet.sayimBasi).toISOString()} açılışından): ${parts.join(" · ")}`].join("\n");
  }
  const a = m.alarm;
  const label = SECURITY_CLASS_LABELS[a.sinif as SecurityClass] ?? a.sinif;
  const ornek = a.ornek ? ` (son kod ${a.ornek})` : "";
  const line = a.tur === "ILK" ? `Eşik aşıldı: dakikada ${a.adet} olay${ornek}; sonraki ${SECURITY_WINDOW_MS / 60_000} dk tek iletide sayılır` : `Son ${SECURITY_WINDOW_MS / 60_000} dk içinde ${a.adet} olay daha${ornek}`;
  return [`<b>GÜVENLİK — patron bulutu</b>`, `Sınıf: ${htmlEscape(label)}`, htmlEscape(line), `Olay zamanı: ${new Date(a.pencereBasi).toISOString()}`].join("\n");
}

function deliver(m: SecurityMessage): void {
  if (!sender) return;
  sender(renderSecurityMessage(m)).then(
    (ok) => (ok ? sent++ : failures++),
    () => failures++,
  );
}

/** Olay yeri çağrısı: senkron, atmaz; `kod` yalnız kısa kod. */
export function securityEvent(sinif: SecurityClass, kod: string | null = null, nowMs: number = Date.now()): void {
  const a = alarm.kaydet(sinif, nowMs, kod && CODE.test(kod) ? kod : null);
  if (a) deliver({ kind: "alarm", alarm: a });
}

export function securityTick(nowMs: number = Date.now()): void {
  for (const a of alarm.tick(nowMs)) deliver({ kind: "alarm", alarm: a });
  const ozet = alarm.gunlukOzet(nowMs);
  if (ozet) deliver({ kind: "ozet", ozet });
}

/** Sır: ortamdan ya da dosyadan (ikisi birden belirsiz; dosya herkese okunursa red). Gerekçe yalnız değişken adı. */
function secret(env: NodeJS.ProcessEnv, name: string): { value: string } | { reason: string } {
  const direct = env[name]?.trim() || undefined;
  const file = env[`${name}_DOSYASI`]?.trim() || undefined;
  if (direct && file) return { reason: `${name} ve ${name}_DOSYASI birlikte verilmiş (belirsiz)` };
  if (direct) return { value: direct };
  if (!file) return { reason: `${name} yok` };
  try {
    // Boş dosya (compose'un isteğe bağlı sırda bağladığı /dev/null dahil) içerik taşımaz: izinden önce "boş" denir.
    const st = statSync(file);
    if (st.size === 0 && !st.isDirectory()) return { reason: `${name}_DOSYASI boş` };
    if ((st.mode & 0o004) !== 0) return { reason: `${name}_DOSYASI herkese okunur (0440/0400 olmalı)` };
    const value = readFileSync(file, "utf8").trim();
    return value ? { value } : { reason: `${name}_DOSYASI boş` };
  } catch {
    return { reason: `${name}_DOSYASI okunamadı` };
  }
}

/** Telegram gönderici (paketsiz fetch; 10 sn zaman aşımı); belirteç adresin içindedir — adres hiçbir yere yazılmaz. */
export function telegramSender(apiRoot: string, token: string, chatId: string, fetchImpl: typeof fetch = fetch): SecuritySend {
  return async (text) => {
    try {
      const res = await fetchImpl(`${apiRoot}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}

/** Güvenlik kanalı: `GUVENLIK_TELEGRAM_BOT_TOKEN` + `GUVENLIK_TELEGRAM_CHAT_ID` (ya da `…_DOSYASI`); eksikse KAPALI. */
export function securityChannelFrom(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): ChannelState {
  const token = secret(env, "GUVENLIK_TELEGRAM_BOT_TOKEN");
  const chat = secret(env, "GUVENLIK_TELEGRAM_CHAT_ID");
  if (!("value" in token) || !("value" in chat)) return { ok: false, reason: [token, chat].flatMap((x) => ("reason" in x ? [x.reason] : [])).join("; ") };
  if (!TOKEN.test(token.value)) return { ok: false, reason: "GUVENLIK_TELEGRAM_BOT_TOKEN biçimsiz" };
  if (!CHAT_ID.test(chat.value)) return { ok: false, reason: "GUVENLIK_TELEGRAM_CHAT_ID biçimsiz" };
  const root = (env.GUVENLIK_TELEGRAM_API_KOKU?.trim() || "https://api.telegram.org").replace(/\/+$/, "");
  const u = URL.canParse(root) ? new URL(root) : null;
  if (!u || !(u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)))) {
    return { ok: false, reason: "GUVENLIK_TELEGRAM_API_KOKU https olmalı (düz http yalnız geri döngü)" };
  }
  return { ok: true, send: telegramSender(root, token.value, chat.value, fetchImpl) };
}

/** Sağlık/günlük metni: kanal kapalıysa "güvenlik bildirimi: KAPALI (<gerekçe>)". */
export function securityChannelSummary(st: ChannelState): string {
  return st.ok ? "güvenlik bildirimi: AÇIK (Telegram; e-posta yok)" : `güvenlik bildirimi: KAPALI (${st.reason})`;
}

/** Sunucu açılışı: kanal açıksa teslimci + periyodik tur; dönen fonksiyon durdurur. */
export function startSecurityAlerts(st: ChannelState): () => void {
  sender = st.ok ? st.send : null;
  securityTick();
  const timer = setInterval(() => securityTick(), TICK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    sender = null;
  };
}

export function securityHealth(nowMs: number = Date.now()) {
  const son24 = alarm.son24Saat(nowMs);
  return { son24Saat: Object.fromEntries(SECURITY_CLASSES.map((c) => [c, son24[c] ?? 0])), kanal: sender ? "ACIK" : "KAPALI", gonderilen: sent, teslimHatasi: failures };
}

/** Yalnız bekçi: süreç durumunu sıfırlar ve isteğe bağlı gönderici takar. */
export function resetSecurityEventsForTest(nowMs: number, send: SecuritySend | null = null): void {
  alarm = new GuvenlikAlarmi({ esikDk: SECURITY_THRESHOLDS, pencereMs: SECURITY_WINDOW_MS }, nowMs);
  sender = send;
  failures = 0;
  sent = 0;
}
