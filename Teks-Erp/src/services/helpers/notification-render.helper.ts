// Bildirim metni + derin bağlantı üretimi (plan §3.7, §4). Basit `{alan}` değiştirme —
// LiquidJS DEĞİL (B6). Eksik alan hata DEĞİL `—`dir: bildirim iş işlemini düşürmez;
// beyan ↔ şablon eşleşmesini `test_bildirim_katalogu §5` ölçer.
import {
  getNotificationEntry,
  type NotificationKind,
  type NotificationPhase,
} from "../../constants/notification-catalog";

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const MISSING = "—";

/** Şablondaki yer tutucu adları (bekçi aynı regex'i buradan alır — tek kaynak). */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

// Metinde sayı Türkçe yazılır ("0,8"); yolda ham kalır (kimlik/sorgu değeri). Gruplama yok:
// tezgah/levent numarası sayı gelirse "1.234" olmasın.
const TR_NUMBER = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, useGrouping: false });

function readValue(payload: Record<string, unknown>, name: string, forText = false): string | null {
  const v = payload[name];
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number") return Number.isFinite(v) ? (forText ? TR_NUMBER.format(v) : String(v)) : null;
  if (typeof v === "boolean") return v ? "evet" : "hayır";
  return null;
}

function fillText(template: string, payload: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_, name: string) => readValue(payload, name, true) ?? MISSING);
}

/** Değer URL-kodlanır; eksik alan → derin bağlantı ekranın köküne düşer (kırık adres yerine liste). */
function fillPath(template: string, root: string, payload: Record<string, unknown>): string {
  let incomplete = false;
  const path = template.replace(PLACEHOLDER, (_, name: string) => {
    const v = readValue(payload, name);
    if (v === null) { incomplete = true; return ""; }
    return encodeURIComponent(v);
  });
  return incomplete ? root : path;
}

export interface RenderedNotification {
  baslik: string;
  govde: string;
  yol: string;
}

export function renderNotification(
  kind: NotificationKind,
  payload: Record<string, unknown> | null | undefined,
  phase: NotificationPhase,
): RenderedNotification {
  const entry = getNotificationEntry(kind);
  const p = payload ?? {};
  const bodyTemplate = phase === "KAPANDI" && entry.cozuldu ? entry.cozuldu : entry.govde;
  return {
    baslik: fillText(entry.baslik, p),
    govde: fillText(bodyTemplate, p),
    yol: fillPath(entry.panelYol, `/${entry.panelEkran}`, p),
  };
}
