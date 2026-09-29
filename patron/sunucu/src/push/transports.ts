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

export type PushOutcome =
  | { readonly kind: "OK" }
  | { readonly kind: "GECERSIZ_CIHAZ" | "GECICI" | "KALICI"; readonly code: string };

export interface PushTransport {
  send(target: PushTarget, msg: PushMessage): Promise<PushOutcome>;
}

const code = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase().slice(0, 40) || "BILINMIYOR";

/** Sahte taşıyıcı: gönderilenleri kaydeder; `sonuc` ile belirli belirtece sonuç dayatılır (bekçi). */
export class RecordingTransport implements PushTransport {
  readonly sent: { target: PushTarget; msg: PushMessage }[] = [];
  readonly forced = new Map<string, PushOutcome>();
  send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    const forced = this.forced.get(target.token);
    if (!forced || forced.kind === "OK") this.sent.push({ target, msg });
    return Promise.resolve(forced ?? { kind: "OK" });
  }
}

/** Expo push (tek mesaj; makbuz ikinci aşaması yok — `DeviceNotRegistered` bilet yanıtında da gelir). */
export class ExpoTransport implements PushTransport {
  constructor(
    private readonly config: Pick<CloudConfig, "EXPO_PUSH_URL" | "EXPO_ERISIM_BELIRTECI">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(target: PushTarget, msg: PushMessage): Promise<PushOutcome> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.config.EXPO_ERISIM_BELIRTECI) headers.Authorization = `Bearer ${this.config.EXPO_ERISIM_BELIRTECI}`;
    const payload = { to: target.token, title: msg.title, body: msg.body, sound: "default", priority: "high", data: { bildirimId: msg.id, rota: msg.route } };
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify([payload]), signal: AbortSignal.timeout(10_000) });
    } catch {
      return { kind: "GECICI", code: "AG_HATASI" };
    }
    if (res.status === 429 || res.status >= 500) return { kind: "GECICI", code: `HTTP_${res.status}` };
    if (!res.ok) return { kind: "KALICI", code: `HTTP_${res.status}` };
    const json = (await res.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } }[] } | null;
    const ticket = json?.data?.[0];
    if (ticket?.status === "ok") return { kind: "OK" };
    const err = ticket?.details?.error ?? "YANIT_BICIMSIZ";
    if (err === "DeviceNotRegistered") return { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" };
    if (err === "MessageRateExceeded") return { kind: "GECICI", code: "EXPO_HIZ_SINIRI" };
    return { kind: "KALICI", code: `EXPO_${code(err)}` };
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
}
