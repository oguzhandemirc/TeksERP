// GÜVENLİK OLAYLARI (B3) — süreç içi tek sayaç + giden kutusuna teslim. Olay yerinde yalnız `securityEvent(sınıf, kod)`
// çağrılır (senkron, atmaz); alarm çekirdeği (`guvenlik-alarm.ts`) eşik + birleştirme penceresi + günlük özeti yönetir,
// teslim kendi kısa tx'inde `bildirim`e yazılır (satıcı DIŞARI BAĞLANMAZ; gönderici güvenlik sohbetine yollar).
// Teslimci kurulmamışsa (CLI, bekçi) olay yalnız sayılır. Sağlık: son 24 saat + güvenlik kanalının son sonucu.
import type { BildirimKanali } from "@prisma/client";
import { enqueueNotificationTx } from "../notifications/outbox";
import { NOTIFICATION_CHANNELS, SECURITY_EVENTS } from "../notifications/catalog";
import { GuvenlikAlarmi, type AlarmIletisi, type GunlukOzet } from "./guvenlik-alarm";
import { lockSecurityAlert } from "./locks";
import type { Db } from "./prisma";

export const SECURITY_CLASSES = ["ERISIM_RED", "IC_API_401", "PORTAL_KILIT", "IMZA_KILIDI", "KIMLIKSIZ_TASIMA", "SIR_DOSYASI_RED", "HIZ_SINIRI", "JWKS_YASI", "YEDEK_ALINAMADI"] as const;
export type SecurityClass = (typeof SECURITY_CLASSES)[number];

export const SECURITY_CLASS_LABELS: Readonly<Record<SecurityClass, string>> = {
  ERISIM_RED: "Erişim kapısı reddi (Cloudflare Access JWT)",
  IC_API_401: "İç API kimlik reddi (401)",
  PORTAL_KILIT: "Portal girişi kilitlendi (hesap + adres)",
  IMZA_KILIDI: "İmza parolası kilitlendi",
  KIMLIKSIZ_TASIMA: "Kimliksiz taşıma talebi seli",
  SIR_DOSYASI_RED: "Sır dosyası izni güvensiz — açılış reddedildi",
  HIZ_SINIRI: "Hız sınırı aşıldı",
  JWKS_YASI: "Erişim JWKS yenilenmiyor (yaş tavanının yarısı geçti ya da aşıldı)",
  YEDEK_ALINAMADI: "Yedek alınamadı (en yeni DB dökümü ya da anahtar arşivi tavandan eski, ya da yedek dizini okunamıyor)",
};

/** Dakikada eşik: tekil olay (kilit, sır izni) 1; sel sınıfları gürültüyü eşik altında tutar. */
export const SECURITY_THRESHOLDS: Readonly<Record<SecurityClass, number>> = {
  ERISIM_RED: 10,
  IC_API_401: 5,
  PORTAL_KILIT: 1,
  IMZA_KILIDI: 1,
  KIMLIKSIZ_TASIMA: 5,
  SIR_DOSYASI_RED: 1,
  HIZ_SINIRI: 3,
  JWKS_YASI: 1,
  YEDEK_ALINAMADI: 1,
};

export const SECURITY_WINDOW_MS = 5 * 60_000;
const TICK_MS = 30_000;
const CODE = /^[A-Z0-9_]{1,40}$/;

type Deliver = (m: { kind: "alarm"; alarm: AlarmIletisi } | { kind: "ozet"; ozet: GunlukOzet }) => Promise<void>;

let alarm = new GuvenlikAlarmi({ esikDk: SECURITY_THRESHOLDS, pencereMs: SECURITY_WINDOW_MS }, Date.now());
let deliver: Deliver | null = null;
let deliveryFailures = 0;
let channelState: Partial<Record<BildirimKanali, string>> = {};

function send(m: Parameters<Deliver>[0]): void {
  if (!deliver) return;
  deliver(m).catch(() => {
    deliveryFailures++;
  });
}

/** Olay yeri çağrısı: senkron, atmaz; `kod` yalnız kısa kod (gerekçe adı) — adres, kullanıcı adı, sır GİRMEZ. */
export function securityEvent(sinif: SecurityClass, kod: string | null = null, nowMs: number = Date.now()): void {
  const a = alarm.kaydet(sinif, nowMs, kod && CODE.test(kod) ? kod : null);
  if (a) send({ kind: "alarm", alarm: a });
}

/** Pencere sonları + günlük özet; teslimci kurulduğunda periyodik koşar (bekçi doğrudan çağırır). */
export function securityTick(nowMs: number = Date.now()): void {
  for (const a of alarm.tick(nowMs)) send({ kind: "alarm", alarm: a });
  const ozet = alarm.gunlukOzet(nowMs);
  if (ozet) send({ kind: "ozet", ozet });
}

function alarmText(a: AlarmIletisi): string {
  const ornek = a.ornek ? ` (son kod ${a.ornek})` : "";
  return a.tur === "ILK"
    ? `Eşik aşıldı: dakikada ${a.adet} olay${ornek}; sonraki ${SECURITY_WINDOW_MS / 60_000} dk tek iletide sayılır`
    : `Son ${SECURITY_WINDOW_MS / 60_000} dk içinde ${a.adet} olay daha${ornek}`;
}

function summaryText(o: GunlukOzet): string {
  const parts = SECURITY_CLASSES.map((c) => `${c} ${o.sayac[c] ?? 0}`);
  const total = SECURITY_CLASSES.reduce((s, c) => s + (o.sayac[c] ?? 0), 0);
  return `${total === 0 ? "Olay yok" : `${total} olay`} — ${parts.join(" · ")}`;
}

/** Giden kutusu teslimcisi: kurulumsuz satır, tekillik sınıf × pencere (alarm) ya da UTC günü (özet). */
export function outboxDelivery(db: Db): Deliver {
  return async (m) => {
    await db.$transaction(async (tx) => {
      await lockSecurityAlert(tx, m.kind === "alarm" ? m.alarm.sinif : "OZET");
      if (m.kind === "alarm") {
        const { alarm: a } = m;
        await enqueueNotificationTx(tx, {
          event: "GUVENLIK_OLAYI",
          keyParts: [a.sinif, a.tur, a.pencereBasi],
          installationDbId: null,
          portalPath: "/denetim",
          konu: SECURITY_CLASS_LABELS[a.sinif as SecurityClass] ?? a.sinif,
          referans: alarmText(a),
          tarih: new Date(a.pencereBasi),
        });
      } else {
        await enqueueNotificationTx(tx, {
          event: "GUVENLIK_OZETI",
          keyParts: [m.ozet.gun],
          installationDbId: null,
          portalPath: "/saglik",
          konu: "Son 24 saat (sayım süreç açılışından)",
          referans: summaryText(m.ozet),
          tarih: new Date(m.ozet.sayimBasi),
        });
      }
    });
  };
}

/** Güvenlik kanalının son sonucu (gönderici yazar): KAPALI → yapılandırılmamış. Sağlık kartı bu önbellekten okur. */
export async function refreshSecurityChannelState(db: Db): Promise<void> {
  const next: Partial<Record<BildirimKanali, string>> = {};
  for (const kanal of NOTIFICATION_CHANNELS) {
    const last = await db.bildirim.findFirst({
      where: { kanal, olay: { in: [...SECURITY_EVENTS] }, durum: { in: ["GONDERILDI", "HATA", "KAPALI"] } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { durum: true },
    });
    next[kanal] = last?.durum ?? "BILINMIYOR";
  }
  channelState = next;
}

/** Teslimciyi ve periyodik turu kurar (sunucu açılışı); dönen fonksiyon durdurur. */
export function startSecurityAlerts(db: Db): () => void {
  deliver = outboxDelivery(db);
  const run = (): void => {
    securityTick();
    void refreshSecurityChannelState(db).catch(() => undefined);
  };
  run();
  const timer = setInterval(run, TICK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    deliver = null;
  };
}

/** Sağlık kartı: sınıf başına son 24 saat + güvenlik kanalı durumu; Telegram (birincil) KAPALI ise uyarı. */
export function securityHealth(nowMs: number = Date.now()) {
  const son24 = alarm.son24Saat(nowMs);
  const telegram = channelState.TELEGRAM ?? "BILINMIYOR";
  return {
    son24Saat: Object.fromEntries(SECURITY_CLASSES.map((c) => [c, son24[c] ?? 0])),
    kanal: { TELEGRAM: telegram, EPOSTA: channelState.EPOSTA ?? "BILINMIYOR" },
    teslimHatasi: deliveryFailures,
    uyari:
      telegram === "KAPALI"
        ? "güvenlik bildirimi: KAPALI (GUVENLIK_TELEGRAM_CHAT_ID yapılandırılmamış)"
        : telegram === "BILINMIYOR"
          ? "güvenlik bildirimi: henüz doğrulanmadı (gönderici sonucu yok)"
          : telegram === "HATA"
            ? "güvenlik bildirimi: son gönderim HATA"
            : null,
  };
}

/** Yalnız bekçi: süreç durumunu sıfırlar ve isteğe bağlı teslimci takar. */
export function resetSecurityEventsForTest(nowMs: number, d: Deliver | null = null): void {
  alarm = new GuvenlikAlarmi({ esikDk: SECURITY_THRESHOLDS, pencereMs: SECURITY_WINDOW_MS }, nowMs);
  deliver = d;
  deliveryFailures = 0;
  channelState = {};
}
