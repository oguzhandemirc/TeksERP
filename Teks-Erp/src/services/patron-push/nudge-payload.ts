// Dürt gövdesi — metin gönderim ANINDA gelen kutusu satırından render edilir (kuyrukta metin yok). Kullanıcı kararı
// 2026-11-13: TAM METİN (başlık + gövde). Rota uygulamanın KENDİ ekranıdır: panel yolu (`panelYol`) uygulamada
// karşılıksızdır, fabrika kimlikleri uygulama kayıt yollarıyla eşleşmez → ERP bildirim listesi `/bildirimler`.
import {
  getNotificationEntry,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "../../constants/notification-catalog";
import { ENVELOPE_VERSION, PushRouteSchema } from "../../cloud-sync/wire";
import type { PushNudgeRequest } from "../../cloud-sync/push-bridge-client";
import { renderNotification } from "../helpers/notification-render.helper";

/** Patron uygulamasında ERP gelen bildirimlerinin listesi (`app/(app)/bildirimler.tsx`, `safeRoute` MODULES'ünde). */
export const PATRON_APP_NOTIFICATIONS_ROUTE = "/bildirimler";
const TITLE_RAW_MAX = 400;
const BODY_RAW_MAX = 4000;

export function isNotificationKind(kind: string): kind is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/** Türün uygulama-güvenli yolu (bugün her tür liste ekranına; P4'te tür başına derin bağlantı açılabilir). */
export function patronPushRoute(_kind: NotificationKind): string {
  return PushRouteSchema.parse(PATRON_APP_NOTIFICATIONS_ROUTE);
}

const clip = (s: string, max: number): string => [...s].slice(0, max).join("");

export function buildNudgeBody(
  inbox: { id: string; kind: NotificationKind; payload: unknown; klass?: string },
  tokens: readonly string[],
): PushNudgeRequest {
  const text = renderNotification(inbox.kind, inbox.payload as Record<string, unknown> | null, "OLAY");
  const title = clip(text.baslik.trim(), TITLE_RAW_MAX) || getNotificationEntry(inbox.kind).ad;
  return {
    v: ENVELOPE_VERSION,
    belirtecler: [...tokens],
    baslik: title,
    govde: clip(text.govde, BODY_RAW_MAX),
    data: { bildirimId: inbox.id, rota: patronPushRoute(inbox.kind) },
    // S0: bulut alarm kanalını/sesini seçsin. BİLDİRİM'de alan YOK (bulut varsayılanı; sesi bilmeyen eski bulutla uyum).
    ...(inbox.klass === "ALARM" ? { sinif: "ALARM" as const } : {}),
  };
}
