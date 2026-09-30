// PUSH TAŞIYICILARI — gönderim kuyruğu yalnız bu arayüzü görür. Üç uygulama:
//   · Kayitli (sahte): yerel/prova/bekçi — ağ YOK, gönderilenleri bellekte tutar (gerçek gönderim yerelde DENENMEZ).
//   · Expo push HTTP API'si (iOS/Android; paketsiz, fetch) · web push (VAPID, `web-push` paketi).
// Sonuç sınıfı dört: OK · GECERSIZ_CIHAZ (cihaz pasife çekilir) · GECICI (yeniden denenir) · KALICI. Hata ayrıntısı
// yalnız KISA KOD olarak döner; ham yanıt gövdesi, başlık ve anahtar günlüğe/DB'ye GİRMEZ.
import webpush from "web-push";
import type { DevicePlatform } from "@prisma/client";
import type { CloudConfig } from "../config";
import { parseWebSubscription } from "./targets";
import type { VapidKeys } from "./vapid";

export interface PushMessage {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly route: string | null;
}

export interface PushTarget {
  readonly platform: DevicePlatform;
  readonly token: string;
}

/** OK'de `ticket`: Expo bileti — teslimin asıl sonucu MAKBUZDA (ikinci aşama, `receipts`). */
export type PushOutcome =
  | { readonly kind: "OK"; readonly ticket?: string }
  | { readonly kind: "GECERSIZ_CIHAZ" | "GECICI" | "KALICI"; readonly code: string };

/** Makbuz yoklaması: bilet → sonuç; henüz hazır olmayan bilet haritada YOKTUR (sonra yeniden sorulur). */
export type ReceiptBatch = { readonly kind: "OK"; readonly results: ReadonlyMap<string, PushOutcome> } | { readonly kind: "GECICI"; readonly code: string };

export interface PushTransport {
  send(target: PushTarget, msg: PushMessage): Promise<PushOutcome>;
  /** Yalnız bilet veren taşıyıcıda (Expo). */
  receipts?(tickets: readonly string[]): Promise<ReceiptBatch>;
}

export const RECEIPT_BATCH = 1000;

/** Expo makbuz/bilet hata adı → sonuç sınıfı (bilet ve makbuz AYNI sınıflamayı kullanır). */
export function expoErrorOutcome(err: string): PushOutcome {
  if (err === "DeviceNotRegistered") return { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" };
  if (err === "MessageRateExceeded") return { kind: "GECICI", code: "EXPO_HIZ_SINIRI" };
  return { kind: "KALICI", code: `EXPO_${code(err)}` };
}

const code = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase().slice(0, 40) || "BILINMIYOR";

/** Sahte taşıyıcı: gönderilenleri kaydeder; `sonuc` ile belirli belirtece sonuç dayatılır (bekçi). */
export class RecordingTransport implements PushTransport {
  readonly sent: { target: PushTarget; msg: PushMessage }[] = [];
  readonly forced = new Map<string, PushOutcome>();
  /** `tickets` açıkken Expo platformlarına bilet verir; makbuz `forcedReceipts`ten (yoksa hazır değil). */
  readonly forcedReceipts = new Map<string, PushOutcome>();
  readonly receiptCalls: string[][] = [];
  private seq = 0;
  constructor(private readonly opts: { tickets?: boolean } = {}) {}
  send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    const forced = this.forced.get(target.token);
    if (!forced || forced.kind === "OK") this.sent.push({ target, msg });
    if (forced) return Promise.resolve(forced);
    const ticket = this.opts.tickets && target.platform !== "WEB" ? `sahte-bilet-${++this.seq}` : undefined;
    return Promise.resolve(ticket ? { kind: "OK", ticket } : { kind: "OK" });
  }
  receipts(tickets: readonly string[]): Promise<ReceiptBatch> {
    this.receiptCalls.push([...tickets]);
    return Promise.resolve({ kind: "OK", results: new Map(tickets.flatMap((t) => (this.forcedReceipts.has(t) ? [[t, this.forcedReceipts.get(t)!] as const] : []))) });
  }
}

/** Expo push: gönderim bilet döner; asıl teslim sonucu makbuzda (`receipts`, ikinci aşama — `DeviceNotRegistered` çoğu kez orada). */
export class ExpoTransport implements PushTransport {
  constructor(
    private readonly config: Pick<CloudConfig, "EXPO_PUSH_URL" | "EXPO_MAKBUZ_URL" | "EXPO_ERISIM_BELIRTECI">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    const headers = this.headers();
    const payload = { to: target.token, title: msg.title, body: msg.body, sound: "default", priority: "high", data: { bildirimId: msg.id, rota: msg.route } };
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify([payload]), signal: AbortSignal.timeout(10_000) });
    } catch {
      return { kind: "GECICI", code: "AG_HATASI" };
    }
    if (res.status === 429 || res.status >= 500) return { kind: "GECICI", code: `HTTP_${res.status}` };
    if (!res.ok) return { kind: "KALICI", code: `HTTP_${res.status}` };
    const json = (await res.json().catch(() => null)) as { data?: { status?: string; id?: string; details?: { error?: string } }[] } | null;
    const ticket = json?.data?.[0];
    if (ticket?.status === "ok") return typeof ticket.id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(ticket.id) ? { kind: "OK", ticket: ticket.id } : { kind: "OK" };
    return expoErrorOutcome(ticket?.details?.error ?? "YANIT_BICIMSIZ");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.config.EXPO_ERISIM_BELIRTECI) h.Authorization = `Bearer ${this.config.EXPO_ERISIM_BELIRTECI}`;
    return h;
  }

  async receipts(tickets: readonly string[]): Promise<ReceiptBatch> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.EXPO_MAKBUZ_URL, { method: "POST", headers: this.headers(), body: JSON.stringify({ ids: tickets.slice(0, RECEIPT_BATCH) }), signal: AbortSignal.timeout(10_000) });
    } catch {
      return { kind: "GECICI", code: "AG_HATASI" };
    }
    if (!res.ok) return { kind: "GECICI", code: `HTTP_${res.status}` };
    const json = (await res.json().catch(() => null)) as { data?: Record<string, { status?: string; details?: { error?: string } }> } | null;
    if (!json?.data || typeof json.data !== "object") return { kind: "GECICI", code: "YANIT_BICIMSIZ" };
    const results = new Map<string, PushOutcome>();
    for (const t of tickets) {
      const r = Object.hasOwn(json.data, t) ? json.data[t] : undefined;
      if (!r) continue;
      results.set(t, r.status === "ok" ? { kind: "OK" } : expoErrorOutcome(r.details?.error ?? "MAKBUZ_BICIMSIZ"));
    }
    return { kind: "OK", results };
  }
}

/** Web push (VAPID). Abonelik ucu gönderimde YENİDEN doğrulanır (izinli servis dışı → KALICI, istek atılmaz). */
export class WebPushTransport implements PushTransport {
  constructor(
    private readonly vapid: VapidKeys,
    private readonly subject: string,
  ) {}

  async send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    const sub = parseWebSubscription(target.token);
    if (!sub) return { kind: "GECERSIZ_CIHAZ", code: "ABONELIK_BICIMSIZ" };
    const payload = JSON.stringify({ baslik: msg.title, metin: msg.body, bildirimId: msg.id, rota: msg.route });
    try {
      await webpush.sendNotification(sub, payload, { vapidDetails: this.vapid.details(this.subject), TTL: 86_400, urgency: "high", timeout: 10_000 });
      return { kind: "OK" };
    } catch (e) {
      const status = typeof (e as { statusCode?: unknown }).statusCode === "number" ? (e as { statusCode: number }).statusCode : null;
      if (status === 404 || status === 410) return { kind: "GECERSIZ_CIHAZ", code: `HTTP_${status}` };
      if (status === null || status === 429 || status >= 500) return { kind: "GECICI", code: status === null ? "AG_HATASI" : `HTTP_${status}` };
      return { kind: "KALICI", code: `HTTP_${status}` };
    }
  }
}

/** Platforma göre yönlendiren taşıyıcı (gerçek kip). */
export class RoutingTransport implements PushTransport {
  constructor(
    private readonly expo: PushTransport,
    private readonly web: PushTransport,
  ) {}
  send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    return target.platform === "WEB" ? this.web.send(target, msg) : this.expo.send(target, msg);
  }
  receipts(tickets: readonly string[]): Promise<ReceiptBatch> {
    return this.expo.receipts ? this.expo.receipts(tickets) : Promise.resolve({ kind: "OK", results: new Map() });
  }
}
