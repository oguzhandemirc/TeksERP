// PUSH TAŞIYICILARI — gönderim kuyruğu yalnız bu arayüzü görür. Üç uygulama:
//   · Kayitli (sahte): yerel/prova/bekçi — ağ YOK, gönderilenleri bellekte tutar (gerçek gönderim yerelde DENENMEZ).
//   · Expo push HTTP API'si (iOS/Android; paketsiz, fetch) · web push (VAPID, `web-push` paketi).
// Sonuç sınıfı dört: OK · GECERSIZ_CIHAZ (cihaz pasife çekilir) · GECICI (yeniden denenir) · KALICI. Hata ayrıntısı
// yalnız KISA KOD olarak döner; ham yanıt gövdesi, başlık ve anahtar günlüğe/DB'ye GİRMEZ.
import webpush from "web-push";
import type { DevicePlatform } from "@prisma/client";
import type { CloudConfig } from "../config";
import { KIND_RULES } from "../catalog/notifications";
import { NOTIFICATION_KINDS, type NotificationKind } from "../wire/api";
import { parseWebSubscription } from "./targets";
import type { VapidKeys } from "./vapid";

export interface PushMessage {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly route: string | null;
  /** Bildirimin tesisi: çok tesisli kimlikte dokunuş önce bu tesise geçer (yük `data.tesisId`). */
  readonly tesisId: string;
  /** Katalog türü: native başlığı katalog etiketinden kurulur (olay metni telefona/aracıya gitmez). Deneme bildiriminde yok. */
  readonly kind?: string;
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

/** Push köprüsü iletisi (ERP kipi): metin fabrikadan gelir, bulut TEMİZLER + KIRPAR ve yalnız İLETİR (saklamaz, günlüğe yazmaz). */
export interface BridgeMessage {
  readonly title: string;
  readonly body: string;
  readonly bildirimId: string;
  readonly rota: string | null;
}

/** Köprü gönderimi: ham Expo belirtecine TAM METİNLİ yük (kullanıcı kararı 2026-11-13: kilit ekranında başlık + gövde). */
export interface BridgeTransport {
  sendBridge(token: string, msg: BridgeMessage): Promise<PushOutcome>;
  /** Toplu gönderim (tek istek, sonuç sırası = belirteç sırası); yoksa köprü sıralı gönderir. */
  sendBridgeBatch?(tokens: readonly string[], msg: BridgeMessage): Promise<PushOutcome[]>;
  receipts?(tickets: readonly string[]): Promise<ReceiptBatch>;
}

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
  readonly bridgeSent: { token: string; msg: BridgeMessage }[] = [];
  readonly bridgeBatches: number[] = [];
  private seq = 0;
  constructor(private readonly opts: { tickets?: boolean } = {}) {}
  async sendBridgeBatch(tokens: readonly string[], msg: BridgeMessage): Promise<PushOutcome[]> {
    this.bridgeBatches.push(tokens.length);
    const out: PushOutcome[] = [];
    for (const t of tokens) out.push(await this.sendBridge(t, msg));
    return out;
  }
  sendBridge(token: string, msg: BridgeMessage): Promise<PushOutcome> {
    const forced = this.forced.get(token);
    if (!forced || forced.kind === "OK") this.bridgeSent.push({ token, msg });
    if (forced) return Promise.resolve(forced);
    const ticket = this.opts.tickets ? `sahte-bilet-${++this.seq}` : undefined;
    return Promise.resolve(ticket ? { kind: "OK", ticket } : { kind: "OK" });
  }
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

/** Native yükün izinli anahtarları — bekçi (`test_bildirim_patron_push`) bu kümeyi ölçer; yeni anahtar bilinçli eklenir. */
export const NATIVE_PAYLOAD_KEYS = ["to", "title", "sound", "priority", "data"] as const;
export const NATIVE_DATA_KEYS = ["bildirimId", "rota", "tesisId"] as const;

/** İÇERİKSİZ native yük (F5): başlık + kimlikler; gövde/tutar/ad Expo'ya, FCM'e ve kilit ekranına GİTMEZ — içerik
 *  uygulama içinden (oturumlu) çekilir. Başlık katalog etiketidir; türsüz (deneme) iletide iletinin sabit başlığı. */
export function nativePushPayload(target: PushTarget, msg: PushMessage) {
  const kind = msg.kind && (NOTIFICATION_KINDS as readonly string[]).includes(msg.kind) ? (msg.kind as NotificationKind) : null;
  const title = kind ? KIND_RULES[kind].label : msg.title.slice(0, 60);
  return { to: target.token, title, sound: "default", priority: "high", data: { bildirimId: msg.id, rota: msg.route, tesisId: msg.tesisId } };
}

/** Köprü yükünün izinli anahtarları — bekçi (`test_bildirim_koprusu`) ölçer. İçerikli: `body` VAR, `tesisId` YOK (ERP kipi). */
export const BRIDGE_PAYLOAD_KEYS = ["to", "title", "body", "sound", "priority", "data"] as const;
export const BRIDGE_DATA_KEYS = ["bildirimId", "rota"] as const;

export function bridgePushPayload(token: string, msg: BridgeMessage) {
  return { to: token, title: msg.title, body: msg.body, sound: "default", priority: "high", data: { bildirimId: msg.bildirimId, rota: msg.rota } };
}

/** Expo push: gönderim bilet döner; asıl teslim sonucu makbuzda (`receipts`, ikinci aşama — `DeviceNotRegistered` çoğu kez orada). */
export class ExpoTransport implements PushTransport {
  constructor(
    private readonly config: Pick<CloudConfig, "EXPO_PUSH_URL" | "EXPO_MAKBUZ_URL" | "EXPO_ERISIM_BELIRTECI">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    return this.post(nativePushPayload(target, msg));
  }

  sendBridge(token: string, msg: BridgeMessage): Promise<PushOutcome> {
    return this.post(bridgePushPayload(token, msg));
  }

  /** Expo dizi kabul eder (≤ 100 ileti): tek istek, bilet sırası ileti sırasıdır. */
  sendBridgeBatch(tokens: readonly string[], msg: BridgeMessage): Promise<PushOutcome[]> {
    return this.postMany(tokens.map((t) => bridgePushPayload(t, msg)));
  }

  private async post(payload: object): Promise<PushOutcome> {
    return (await this.postMany([payload]))[0]!;
  }

  private async postMany(payloads: readonly object[]): Promise<PushOutcome[]> {
    const all = (o: PushOutcome): PushOutcome[] => payloads.map(() => o);
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.EXPO_PUSH_URL, { method: "POST", headers: this.headers(), body: JSON.stringify(payloads), signal: AbortSignal.timeout(10_000) });
    } catch {
      return all({ kind: "GECICI", code: "AG_HATASI" });
    }
    if (res.status === 429 || res.status >= 500) return all({ kind: "GECICI", code: `HTTP_${res.status}` });
    if (!res.ok) return all({ kind: "KALICI", code: `HTTP_${res.status}` });
    const json = (await res.json().catch(() => null)) as { data?: { status?: string; id?: string; details?: { error?: string } }[] } | null;
    return payloads.map((_, k): PushOutcome => {
      const ticket = Array.isArray(json?.data) ? json.data[k] : undefined;
      if (ticket?.status === "ok") return typeof ticket.id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(ticket.id) ? { kind: "OK", ticket: ticket.id } : { kind: "OK" };
      return expoErrorOutcome(ticket?.details?.error ?? "YANIT_BICIMSIZ");
    });
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

/** Web push gövdesi (servis işçisi okur): başlık · metin · bildirim kimliği · rota · tesis. */
export const webPushPayload = (msg: PushMessage): string => JSON.stringify({ baslik: msg.title, metin: msg.body, bildirimId: msg.id, rota: msg.route, tesisId: msg.tesisId });

/** Web push (VAPID). Abonelik ucu gönderimde YENİDEN doğrulanır (izinli servis dışı → KALICI, istek atılmaz). */
export class WebPushTransport implements PushTransport {
  constructor(
    private readonly vapid: VapidKeys,
    private readonly subject: string,
  ) {}

  async send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    const sub = parseWebSubscription(target.token);
    if (!sub) return { kind: "GECERSIZ_CIHAZ", code: "ABONELIK_BICIMSIZ" };
    const payload = webPushPayload(msg);
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

/** Platforma göre yönlendiren taşıyıcı (gerçek kip). Native kapısı kapalıyken telefon hedefine İSTEK ATILMAZ
 *  (`BILDIRIM_NATIVE_PUSH=kapali`, varsayılan): sonuç KALICI `NATIVE_PUSH_KAPALI`, web push aynen sürer. */
export class RoutingTransport implements PushTransport {
  constructor(
    private readonly expo: PushTransport,
    private readonly web: PushTransport,
    private readonly native: boolean = false,
  ) {}
  send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    if (target.platform === "WEB") return this.web.send(target, msg);
    if (!this.native) return Promise.resolve({ kind: "KALICI", code: "NATIVE_PUSH_KAPALI" });
    return this.expo.send(target, msg);
  }
  receipts(tickets: readonly string[]): Promise<ReceiptBatch> {
    return this.expo.receipts ? this.expo.receipts(tickets) : Promise.resolve({ kind: "OK", results: new Map() });
  }
}
