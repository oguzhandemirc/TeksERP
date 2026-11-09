// =============================================================================
// TARİH KUTUSU — hazır seçim ↔ URL (dateField/dateFrom/dateTo), fabrika günüyle
// =============================================================================
// URL yalnız mutlak an taşır (kayıtlı görünüm sözleşmesi değişmez); hazır seçimin adı
// URL'den GERİ OKUNUR ("Son 7 gün" = bugünden 6 gün öncesinin başı … bugünün sonu).
// Gün sınırları fabrika diliminden (`lib/factory-time`); çıplak Date matematiği yok.
// =============================================================================
import { addDaysToKey, factoryDayEndIso, factoryDayKey, factoryDayStartIso, fmtDayKey } from "@/lib/factory-time";

export type DatePresetId = "all" | "today" | "last7" | "last30" | "past" | "range";

export interface DatePresetState {
  id: DatePresetId;
  field: string;
  /** Yalnız `range` için anlamlı: `yyyy-MM-dd` fabrika günü ("" = açık uç). */
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
  const fromIso = sp.get("dateFrom");
  const toIso = sp.get("dateTo");
  return presetFromDayKeys(fromIso ? factoryDayKey(fromIso) : "", toIso ? factoryDayKey(toIso) : "", sp.get("dateField") ?? defaultField, now);
}

/** Fabrika günü uçları (`yyyy-MM-dd`, "" = açık) → hazır seçim adı; URL'siz (yerel durumlu) süzgeçler de okur. */
export function presetFromDayKeys(from: string, to: string, field: string, now: Date = new Date()): DatePresetState {
  if (!from && !to) return { id: "all", field, from, to };
  const today = factoryDayKey(now);
  if (!from && to === addDaysToKey(today, -1)) return { id: "past", field, from, to };
  for (const [id, days] of Object.entries(WINDOW_DAYS) as [DatePresetId, number][]) {
    if (to === today && from === addDaysToKey(today, -(days - 1))) return { id, field, from, to };
  }
  return { id: "range", field, from, to };
}

/** Hazır seçim → fabrika günü uçları (`all` = iki uç boş). URL yazımı ile yerel süzgeç aynı hesaptan. */
export function dayKeysOfPreset(st: DatePresetState, now: Date = new Date()): { from: string; to: string } {
  if (st.id === "all") return { from: "", to: "" };
  const today = factoryDayKey(now);
  const days = WINDOW_DAYS[st.id];
  if (days) return { from: addDaysToKey(today, -(days - 1)), to: today };
  if (st.id === "past") return { from: "", to: addDaysToKey(today, -1) };
  return { from: st.from, to: st.to };
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
  const { from, to } = dayKeysOfPreset(st, now);
  if (!from && !to) {
    next.delete("dateField");
    return next;
  }
  next.set("dateField", st.field);
  if (from) next.set("dateFrom", factoryDayStartIso(from));
  if (to) next.set("dateTo", factoryDayEndIso(to));
  return next;
}

/** Kutudaki değer yazısı; `pastLabel` alanın diliyle ("Termini geçmiş"). */
export function datePresetText(st: DatePresetState, pastLabel = DATE_PRESET_LABELS.past): string {
  if (st.id === "past") return pastLabel;
  if (st.id !== "range") return DATE_PRESET_LABELS[st.id];
  if (st.from && st.to) return st.from === st.to ? fmtDayKey(st.from) : `${fmtDayKey(st.from)} – ${fmtDayKey(st.to)}`;
  return st.from ? `${fmtDayKey(st.from)} sonrası` : `${fmtDayKey(st.to)} öncesi`;
}
