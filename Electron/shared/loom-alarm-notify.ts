// =============================================================================
// TEZGAH ALARMI — işletim sistemi bildirimi sözleşmesi (ana süreç + renderer ortak, saf)
// =============================================================================
// İstek alarm kimliği + düz metin taşır; ADRES TAŞIMAZ. Tıklamada ana süreç yalnız alarm
// kimliğini geri yollar, renderer sayfa yolunu kendisi kurar — kanal keyfi URL açmanın
// kapısı olmasın. Başka her şekil (ek alan, uuid olmayan kimlik, uzun metin) reddedilir.
// =============================================================================

export const LOOM_ALARM_NOTIFY_CHANNEL = "loom-alarm:notify";
export const LOOM_ALARM_OPEN_CHANNEL = "loom-alarm:open";

export const NOTIFY_TITLE_MAX = 120;
export const NOTIFY_BODY_MAX = 300;

export interface LoomAlarmNotifyRequest {
  alarmId: string;
  title: string;
  body: string;
}

export type LoomAlarmNotifyResult = { shown: true } | { shown: false; reason: "invalid" | "focused" | "unsupported" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = ["alarmId", "body", "title"];

export const isAlarmId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function boundedText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/** Yalnız `{ alarmId: uuid, title, body }` geçer; ek alan / adres / bozuk kimlik → null (RED). */
export function parseLoomAlarmNotifyRequest(raw: unknown): LoomAlarmNotifyRequest | null {
  if (!isPlainObject(raw)) return null;
  const keys = Object.keys(raw).sort();
  if (keys.length !== REQUEST_KEYS.length || keys.some((k, i) => k !== REQUEST_KEYS[i])) return null;
  const { alarmId, title, body } = raw;
  if (!isAlarmId(alarmId) || !boundedText(title, NOTIFY_TITLE_MAX) || !boundedText(body, NOTIFY_BODY_MAX)) return null;
  return { alarmId, title, body };
}

/** Ana süreçten gelen "alarmı aç" olayı: yalnız `{ alarmId: uuid }`; başka şekil → null. */
export function parseLoomAlarmOpenEvent(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "alarmId") return null;
  return isAlarmId(raw.alarmId) ? raw.alarmId : null;
}

/** Bildirim yalnız pencere arkadayken / simge durumundayken / gizliyken çıkar. */
export function shouldShowOsNotification(w: { focused: boolean; minimized: boolean; visible: boolean }): boolean {
  return w.minimized || !w.visible || !w.focused;
}

/** Alarm sayfası yolu — yalnız doğrulanmış kimlikle kurulur. */
export function loomAlarmPath(alarmId: string): string | null {
  return isAlarmId(alarmId) ? `/operations/loom-alarms/${alarmId}` : null;
}
