// =============================================================================
// TARİH KUTUSU — hazır seçim ↔ URL (dateField/dateFrom/dateTo), yerel günle
// =============================================================================
// URL yalnız mutlak an taşır (kayıtlı görünüm sözleşmesi değişmez); hazır seçimin adı
// URL'den GERİ OKUNUR ("Son 7 gün" = bugünden 6 gün öncesinin başı … bugünün sonu).
// Gün sınırları FilterBar'ın tarih kutusuyla AYNI kuraldan: istemcinin yerel günü (bu sürümde
// `lib/factory-time` yok; dilim literali yazılmaz — `new Date(y, m, d)` yerel saatle kurar).
// =============================================================================

/** `yyyy-MM-dd` yerel gün anahtarı. */
export function localDayKey(input: Date | string = new Date()): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseKey(key: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  return [y, m, d];
}

export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = parseKey(key);
  return localDayKey(new Date(y, m - 1, d + days, 12));
}

export function dayStartIso(key: string): string {
  const [y, m, d] = parseKey(key);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function dayEndIso(key: string): string {
  const [y, m, d] = parseKey(key);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/** `yyyy-MM-dd` → `dd.MM.yyyy`. */
export function fmtDayKey(key: string): string {
  const [y, m, d] = key.split("-");
  return y && m && d ? `${d}.${m}.${y}` : "—";
}

export type DatePresetId = "all" | "today" | "last7" | "last30" | "past" | "range";

export interface DatePresetState {
  id: DatePresetId;
  field: string;
  /** Yalnız `range` için anlamlı: `yyyy-MM-dd` yerel gün ("" = açık uç). */
  from: string;
  to: string;
}

const WINDOW_DAYS: Partial<Record<DatePresetId, number>> = { today: 1, last7: 7, last30: 30 };

export const DATE_PRESET_LABELS: Record<DatePresetId, string> = {
  all: "Tümü",
  today: "Bugün",
  last7: "Son 7 gün",
  last30: "Son 30 gün",
  past: "Geçmiş",
  range: "Tarih aralığı",
};

/** URL → kutu durumu. Tanınmayan mutlak aralık `range` olarak okunur (değer korunur). */
export function readDatePreset(sp: URLSearchParams, defaultField: string, now: Date = new Date()): DatePresetState {
  const field = sp.get("dateField") ?? defaultField;
  const fromIso = sp.get("dateFrom");
  const toIso = sp.get("dateTo");
  const from = fromIso ? localDayKey(fromIso) : "";
  const to = toIso ? localDayKey(toIso) : "";
  if (!from && !to) return { id: "all", field, from, to };
  const today = localDayKey(now);
  if (!from && to === addDaysToKey(today, -1)) return { id: "past", field, from, to };
  for (const [id, days] of Object.entries(WINDOW_DAYS) as [DatePresetId, number][]) {
    if (to === today && from === addDaysToKey(today, -(days - 1))) return { id, field, from, to };
  }
  return { id: "range", field, from, to };
}

/** Kutu durumu → URL. `all` tarih anahtarlarını siler; cursor/page sıfırlanır. */
export function applyDatePreset(sp: URLSearchParams, st: DatePresetState, now: Date = new Date()): URLSearchParams {
  const next = new URLSearchParams(sp);
  next.delete("cursor");
  next.delete("page");
  next.delete("dateFrom");
  next.delete("dateTo");
  if (st.id === "all") {
    next.delete("dateField");
    return next;
  }
  next.set("dateField", st.field);
  const today = localDayKey(now);
  const days = WINDOW_DAYS[st.id];
  if (days) {
    next.set("dateFrom", dayStartIso(addDaysToKey(today, -(days - 1))));
    next.set("dateTo", dayEndIso(today));
  } else if (st.id === "past") {
    next.set("dateTo", dayEndIso(addDaysToKey(today, -1)));
  } else {
    if (st.from) next.set("dateFrom", dayStartIso(st.from));
    if (st.to) next.set("dateTo", dayEndIso(st.to));
    if (!st.from && !st.to) next.delete("dateField");
  }
  return next;
}

/** Kutudaki değer yazısı; `pastLabel` alanın diliyle ("Termini geçmiş"). */
export function datePresetText(st: DatePresetState, pastLabel = DATE_PRESET_LABELS.past): string {
  if (st.id === "past") return pastLabel;
  if (st.id !== "range") return DATE_PRESET_LABELS[st.id];
  if (st.from && st.to) return st.from === st.to ? fmtDayKey(st.from) : `${fmtDayKey(st.from)} – ${fmtDayKey(st.to)}`;
  return st.from ? `${fmtDayKey(st.from)} sonrası` : `${fmtDayKey(st.to)} öncesi`;
}
