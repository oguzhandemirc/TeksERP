// =============================================================================
// BİLDİRİM — masaüstü OS bildirimi + görev çubuğu rozeti sözleşmesi (ana süreç + renderer, saf)
// =============================================================================
// Yük iş verisinden en az taşır (başlık + kısa gövde; tutar yok). `yol` yalnız uygulama içi
// göreli yoldur — şema/çift eğik/ters eğik RED: kanal keyfi URL açmanın kapısı olmasın.
// Tıklamada ana süreç yalnız `{bildirimId, yol}` geri yollar; renderer yolu YİNE doğrular.
// =============================================================================
import { NOTIFY_BODY_MAX, NOTIFY_TITLE_MAX, isAlarmId } from "./loom-alarm-notify";

export const BILDIRIM_NOTIFY_CHANNEL = "bildirim:notify";
export const BILDIRIM_OPEN_CHANNEL = "bildirim:open";
export const BILDIRIM_BADGE_CHANNEL = "bildirim:rozet";

export const BILDIRIM_YOL_MAX = 300;
const KIND_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
// Göreli uygulama yolu: "/" ile başlar, ikinci karakter "/" değil; sorgu dizgesine izin var.
const YOL_RE = /^\/(?!\/)[A-Za-z0-9\-._~/?=&%+]*$/;

export type BildirimKlass = "ALARM" | "BILDIRIM";

export interface BildirimNotifyRequest {
  kind: string;
  baslik: string;
  govde?: string;
  yol: string;
  klass: BildirimKlass;
  bildirimId: string;
}

export type BildirimNotifyResult = { shown: true } | { shown: false; reason: "invalid" | "focused" | "unsupported" };

export interface BildirimRozetRequest {
  /** Okunmamış BİLDİRİM sayısı — zil rozetiyle aynı kaynak (`/ozet.okunmamis`). */
  okunmamis: number;
  /** Açık tezgah alarmı var mı (`/ozet.alarmAcik > 0`) → pencere yanıp söner. */
  alarm: boolean;
}

export interface BildirimOpenEvent {
  bildirimId: string;
  yol: string;
}

const REQUIRED_KEYS = ["baslik", "bildirimId", "kind", "klass", "yol"];

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function boundedText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

export function isAppPath(v: unknown): v is string {
  return typeof v === "string" && v.length <= BILDIRIM_YOL_MAX && YOL_RE.test(v) && !v.includes("..");
}

function exactKeys(raw: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(raw);
  if (!required.every((k) => k in raw)) return false;
  return keys.every((k) => required.includes(k) || optional.includes(k));
}

/** Yalnız beyanlı şekil geçer; ek alan / dış adres / bozuk kimlik → null (RED). */
export function parseBildirimNotifyRequest(raw: unknown): BildirimNotifyRequest | null {
  if (!isPlainObject(raw) || !exactKeys(raw, REQUIRED_KEYS, ["govde"])) return null;
  const { kind, baslik, govde, yol, klass, bildirimId } = raw;
  if (typeof kind !== "string" || !KIND_RE.test(kind)) return null;
  if (!boundedText(baslik, NOTIFY_TITLE_MAX)) return null;
  if (govde !== undefined && !(typeof govde === "string" && govde.length <= NOTIFY_BODY_MAX)) return null;
  if (!isAppPath(yol) || (klass !== "ALARM" && klass !== "BILDIRIM") || !isAlarmId(bildirimId)) return null;
  return { kind, baslik, ...(govde ? { govde } : {}), yol, klass, bildirimId };
}

export function parseBildirimOpenEvent(raw: unknown): BildirimOpenEvent | null {
  if (!isPlainObject(raw) || !exactKeys(raw, ["bildirimId", "yol"], [])) return null;
  return isAlarmId(raw.bildirimId) && isAppPath(raw.yol) ? { bildirimId: raw.bildirimId, yol: raw.yol } : null;
}

export function parseBildirimRozetRequest(raw: unknown): BildirimRozetRequest | null {
  if (!isPlainObject(raw) || !exactKeys(raw, ["alarm", "okunmamis"], [])) return null;
  const { okunmamis, alarm } = raw;
  if (typeof okunmamis !== "number" || !Number.isInteger(okunmamis) || okunmamis < 0 || okunmamis > 1_000_000) return null;
  if (typeof alarm !== "boolean") return null;
  return { okunmamis, alarm };
}

/** Windows overlay ikon anahtarı: 0 → null (ikon kalkar), 1..9 → "1".."9", 10+ → "9+". */
export function overlayIconKey(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 9 ? "9+" : String(Math.floor(n));
}

/** Ekran okuyucu metni (Windows overlay açıklaması). */
export function overlayDescription(n: number): string {
  return n > 0 ? `${n} okunmamış bildirim` : "";
}

/** `9+` dosya adında "plus" olur (ör. `overlay/9plus.png`). */
export function overlayIconFile(key: string): string {
  return `${key === "9+" ? "9plus" : key}.png`;
}
