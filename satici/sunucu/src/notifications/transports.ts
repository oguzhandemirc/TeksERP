// BİLDİRİM TAŞIYICILARI — yalnız yan konteyner (gönderici) kullanır; paketsiz, `fetch` ile:
//   · Telegram Bot API `sendMessage` (grup sohbeti, HTML biçimi, bağlantı önizlemesi kapalı)
//   · Resend HTTP API `POST /emails` (düz metin; `Idempotency-Key` = satır kimliği → aynı satırın yeniden
//     denenmesi ikinci e-posta DOĞURMAZ)
// Sonuç üç sınıf: OK · GECICI (yeniden denenir; 429'da sağlayıcının bekleme süresi) · KALICI. Hata yalnız KISA KOD
// döner (`^[A-Z0-9_]+$`, DB seddi de bunu ister): ham yanıt gövdesi, başlık, bot belirteci ve API anahtarı
// günlüğe/DB'ye GİRMEZ (belirteç Telegram adresinin içindedir — adres hiçbir yere yazılmaz).
import type { BildirimKanali } from "@prisma/client";
import type { RenderedMessage } from "./message";

export type SendOutcome =
  | { readonly kind: "OK"; readonly providerId: string | null }
  | { readonly kind: "GECICI"; readonly code: string; readonly retryAfterMs?: number }
  | { readonly kind: "KALICI"; readonly code: string };

export interface NotificationTransport {
  readonly channel: BildirimKanali;
  send(msg: RenderedMessage, idempotencyKey: string): Promise<SendOutcome>;
}

const TIMEOUT_MS = 10_000;
const PROVIDER_ID = /^[A-Za-z0-9_.:-]{1,100}$/;

/** HTTP durumunun ortak sınıflaması (429/5xx geçici, diğer 4xx kalıcı). */
function classify(prefix: string, status: number, retryAfterSec: number | null): SendOutcome {
  if (status === 429) return { kind: "GECICI", code: `${prefix}_HIZ_SINIRI`, ...(retryAfterSec ? { retryAfterMs: retryAfterSec * 1000 } : {}) };
  if (status >= 500 || status === 408) return { kind: "GECICI", code: `${prefix}_HTTP_${status}` };
  return { kind: "KALICI", code: `${prefix}_HTTP_${status}` };
}

const seconds = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 86_400) : null;
};

export interface TelegramSettings {
  readonly apiRoot: string;
  readonly token: string;
  readonly chatId: string;
}

export class TelegramTransport implements NotificationTransport {
  readonly channel = "TELEGRAM" as const;
  constructor(
    private readonly s: TelegramSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: RenderedMessage): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.s.apiRoot}/bot${this.s.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.s.chatId, text: msg.telegramHtml, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { kind: "GECICI", code: "TELEGRAM_AG_HATASI" };
    }
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: unknown }; parameters?: { retry_after?: unknown; migrate_to_chat_id?: unknown } } | null;
    if (res.ok && json?.ok === true) {
      const id = String(json.result?.message_id ?? "");
      return { kind: "OK", providerId: PROVIDER_ID.test(id) ? id : null };
    }
    // Grup süper gruba yükseldi: sohbet kimliği değişti (TELEGRAM_CHAT_ID güncellenmeli) — yeniden denemek boşuna.
    if (json?.parameters?.migrate_to_chat_id !== undefined) return { kind: "KALICI", code: "TELEGRAM_SOHBET_TASINDI" };
    return classify("TELEGRAM", res.status, seconds(json?.parameters?.retry_after));
  }
}

export interface ResendSettings {
  readonly apiRoot: string;
  readonly apiKey: string;
  readonly from: string;
  readonly to: readonly string[];
}

export class ResendTransport implements NotificationTransport {
  readonly channel = "EPOSTA" as const;
  constructor(
    private readonly s: ResendSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: RenderedMessage, idempotencyKey: string): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.s.apiRoot}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.s.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "User-Agent": "tekserp-satici-bildirim/1",
        },
        body: JSON.stringify({ from: this.s.from, to: [...this.s.to], subject: msg.subject, text: msg.text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { kind: "GECICI", code: "RESEND_AG_HATASI" };
    }
    const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (res.ok) {
      const id = typeof json?.id === "string" && PROVIDER_ID.test(json.id) ? json.id : null;
      return { kind: "OK", providerId: id };
    }
    // 409: aynı anahtarlı istek hâlâ işleniyor — aynı anahtarla sonra sorulur, ikinci e-posta doğmaz.
    if (res.status === 409) return { kind: "GECICI", code: "RESEND_HTTP_409" };
    return classify("RESEND", res.status, seconds(res.headers.get("retry-after")));
  }
}
