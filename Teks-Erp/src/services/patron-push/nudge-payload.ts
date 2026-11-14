// Dürt gövdesi — metin gönderim ANINDA gelen kutusu satırından render edilir (kuyrukta metin yok). Kullanıcı kararı
// 2026-11-13: TAM METİN (başlık + gövde). Rota uygulamanın KENDİ ekranıdır; 2026-11-15 kararı: sipariş/cari/sevkiyat/
// teklif/iş emri türü kaydına (`/bolum/<UUID>`, mevcut `rota` alanı — tel ve bulut değişmez), diğerleri `/bildirimler`.
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

/**
 * Kayda giden türler: panel yolu kimliğin HANGİ tablonun olduğunu söyler (`focus={cariId}` cari HESABI, `C:{cariId}`
 * cari KARTI) → uygulama bölümü. Uygulama `/teklifler|/sevkiyat|/uretim/<id>`i kendi kayıt ekranına çevirir; bunu
 * bilmeyen eski uygulama listeye düşer. Yalnız tür ön eki + kayıt UUID'si gider; metin/kişisel veri yok.
 */
const RECORD_ROUTE_BY_PANEL_PATH: Readonly<Record<string, { readonly field: string; readonly section: string }>> = {
  "/operations/orders?focus={siparisId}": { field: "siparisId", section: "/siparisler" },
  "/definitions/cariler?kayit=C:{cariId}": { field: "cariId", section: "/cariler" },
  "/operations/shipments/{sevkiyatId}": { field: "sevkiyatId", section: "/sevkiyat" },
  "/cost/quotes/{teklifId}": { field: "teklifId", section: "/teklifler" },
  "/operations/work-orders/{isEmriId}": { field: "isEmriId", section: "/uretim" },
};
/** Kullanıcı kararı (2026-11-15): yalnız bu ön eklerin türleri kayda gider (kurşun/tambur iş emri yolunu paylaşsa da listeye). */
const RECORD_KIND_PREFIXES: ReadonlySet<string> = new Set(["siparis", "cari", "sevkiyat", "teklif", "isemri"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Türün uygulama-güvenli yolu: kayda giden türde kimlik UUID ise `/bolum/<id>`, değilse ERP bildirim listesi. */
export function patronPushRoute(kind: NotificationKind, payload?: unknown): string {
  const panelPath = getNotificationEntry(kind).panelYol;
  const target = RECORD_KIND_PREFIXES.has(kind.split(".")[0] ?? "") && Object.hasOwn(RECORD_ROUTE_BY_PANEL_PATH, panelPath) ? RECORD_ROUTE_BY_PANEL_PATH[panelPath] : undefined;
  const id = target && payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>)[target.field] : undefined;
  const route = target && typeof id === "string" && UUID_RE.test(id) ? `${target.section}/${id.toLowerCase()}` : PATRON_APP_NOTIFICATIONS_ROUTE;
  return PushRouteSchema.parse(route);
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
    data: { bildirimId: inbox.id, rota: patronPushRoute(inbox.kind, inbox.payload) },
    // S0: bulut alarm kanalını/sesini seçsin. BİLDİRİM'de alan YOK (bulut varsayılanı; sesi bilmeyen eski bulutla uyum).
    ...(inbox.klass === "ALARM" ? { sinif: "ALARM" as const } : {}),
  };
}
