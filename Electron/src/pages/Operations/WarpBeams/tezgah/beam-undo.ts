// =============================================================================
// GERİ ALMA ADAYLARI — sunucunun LIFO yükleminin panel aynası (saf fonksiyon, test edilir)
// =============================================================================
// Yalnız en yeni AKTİF (ters bağı olmayan) durum olayı geri alınabilir ve bu uçtan yalnız tezgah
// ailesi (MOUNTED · DISMOUNTED · EXHAUSTED · SCRAPPED); WOUND/SHIP_OUT/RETURNED_IN kendi ucundan.
// Tüketim satırları LIFO dışıdır: ters bağı olmayan her CONSUMED geri alınabilir.
// =============================================================================
import type { WarpBeamEvent, WarpBeamStatus } from "../types";

export const STATUS_EVENT_KINDS = ["WOUND", "SHIP_OUT", "RETURNED_IN", "MOUNTED", "DISMOUNTED", "EXHAUSTED", "SCRAPPED"] as const;
export const UNDOABLE_STATUS_KINDS = ["MOUNTED", "DISMOUNTED", "EXHAUSTED", "SCRAPPED"] as const;

export interface UndoCandidates {
  /** LIFO adayı — en yeni aktif durum olayı bu uçtan geri alınabiliyorsa. */
  lifo: WarpBeamEvent | null;
  /** En yeni aktif durum olayı başka ailedense (WOUND vb.) adıyla — kullanıcı neden geri alamadığını görsün. */
  blockedBy: string | null;
  consumed: WarpBeamEvent[];
}

export function undoCandidates(events: WarpBeamEvent[]): UndoCandidates {
  const reversed = new Set(events.map((e) => e.reversesEventId).filter((x): x is string => !!x));
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const active = sorted.filter((e) => !reversed.has(e.id));
  const statusEvents = active.filter((e) => (STATUS_EVENT_KINDS as readonly string[]).includes(e.kind));
  const last = statusEvents[statusEvents.length - 1] ?? null;
  const lifo = last && (UNDOABLE_STATUS_KINDS as readonly string[]).includes(last.kind) ? last : null;
  return { lifo, blockedBy: last && !lifo ? last.kind : null, consumed: active.filter((e) => e.kind === "CONSUMED").reverse() };
}

/** Geri alma menüsü hangi durumlarda anlamlı (adayın varlığı diyalogda ölçülür). */
export const undoMenuEnabled = (s: WarpBeamStatus): boolean => s === "READY" || s === "MOUNTED" || s === "EXHAUSTED" || s === "SCRAPPED";

export const STATUS_EVENT_LABEL: Record<string, string> = {
  MOUNTED: "Takma", DISMOUNTED: "Söküm", EXHAUSTED: "Bitiş", SCRAPPED: "Hurda", CONSUMED: "Tüketim",
  WOUND: "Sarım", SHIP_OUT: "Fasona sevk", RETURNED_IN: "Fasondan dönüş",
};
