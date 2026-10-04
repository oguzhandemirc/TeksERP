// İLETİ KURUCU — gönderici (yan konteyner) giden kutusu satırından e-posta konusu/metni ve Telegram HTML'ini kurar.
// YALNIZ olay türü + allowlist gövdesi okunur (NotificationBodySchema'dan geçmiş); başka kaynak yoktur, yani talep
// metni, ek, sağlık ayrıntısı iletilere yapısal olarak giremez. Bağlantı `BILDIRIM_PORTAL_ADRESI` (ör.
// https://portal.<alan>/portal) + gövdenin göreli yolu; adres verilmezse yalnız yol yazılır.
import type { BildirimOlayi } from "@prisma/client";
import { NOTIFICATION_TITLES, type NotificationBody } from "./catalog";

export interface RenderedMessage {
  readonly subject: string;
  readonly text: string;
  readonly telegramHtml: string;
}

export interface RenderOptions {
  /** Portal kökü (sonunda `/` yok); null → bağlantı yerine yol. */
  readonly portalBase: string | null;
  readonly timeZone: string;
  /** Olayın doğduğu an (satırın `createdAt`i). */
  readonly createdAt: Date;
}

/** `tarih` alanının olaya göre adı. */
const DATE_LABEL: Partial<Record<BildirimOlayi, string>> = {
  KURULUM_SESSIZ: "Son başarılı yoklama",
  KIRA_BITISI_YAKLASIYOR: "Kira bitişi",
  GECERLILIK_BITISI_YAKLASIYOR: "Geçerlilik bitişi",
  TAKSIT_VADESI_YAKLASIYOR: "Vade",
  TAKSIT_GECIKTI: "Vade",
  PLANLI_EYLEM_UYGULANDI: "Planlanan vade",
  GUNCELLEME_TAMAMLANDI: "Bitiş",
  GUNCELLEME_GERI_DONDU: "Bitiş",
  GUNCELLEME_BASARISIZ: "Bitiş",
  ANAHTAR_SURESI_BITIYOR: "Sertifika bitişi",
};

const htmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function formatTime(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** Etiket satırları (sıra sabit): fabrika yolu · lisans · konu · ayrıntı · tarih · olay zamanı. */
function lines(event: BildirimOlayi, body: NotificationBody, opts: RenderOptions): [string, string][] {
  const out: [string, string][] = [];
  const where = [body.musteri, body.tesis, body.kurulum].filter((x): x is string => x !== null);
  if (where.length > 0) out.push(["Fabrika", where.join(" › ")]);
  if (body.lisansNo || body.sinif) out.push(["Lisans", [body.lisansNo, body.sinif ? `(${body.sinif})` : null].filter(Boolean).join(" ")]);
  if (body.konu) out.push(["Konu", body.konu]);
  if (body.referans) out.push(["Ayrıntı", body.referans]);
  if (body.tarih) out.push([DATE_LABEL[event] ?? "Tarih", formatTime(body.tarih, opts.timeZone)]);
  out.push(["Olay zamanı", formatTime(opts.createdAt, opts.timeZone)]);
  return out;
}

export function portalLink(body: NotificationBody, portalBase: string | null): string {
  return portalBase ? `${portalBase}${body.portalYolu}` : `/portal${body.portalYolu}`;
}

export function renderMessage(event: BildirimOlayi, body: NotificationBody, opts: RenderOptions): RenderedMessage {
  const title = NOTIFICATION_TITLES[event];
  const rows = lines(event, body, opts);
  const link = portalLink(body, opts.portalBase);
  const subject = `[TeksERP satıcı] ${title}${body.musteri ? ` — ${body.musteri}` : ""}`.slice(0, 200);
  const text = [
    title,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `${opts.portalBase ? "Portalda aç" : "Portal yolu"}: ${link}`,
    "",
    "Bu ileti TeksERP satıcı platformundan otomatik gönderildi; yanıtlamayın.",
  ].join("\n");
  const linkHtml = opts.portalBase ? `<a href="${htmlEscape(link)}">Portalda aç</a>` : `Portal yolu: <code>${htmlEscape(link)}</code>`;
  const telegramHtml = [`<b>${htmlEscape(title)}</b>`, ...rows.map(([k, v]) => `${htmlEscape(k)}: ${htmlEscape(v)}`), linkHtml].join("\n");
  return { subject, text, telegramHtml };
}
