// =============================================================================
// OFFSITE KART DURUMU — saf türetme (test edilebilir, React'siz)
// =============================================================================
// Bayatlık KARARI sunucuda (`offsite-state.ts`, `stale`); burası yalnız kartın
// üç durumunu ve cümlelerini kurar. Eski sunucu `stale` göndermez ⇒ alan yoksa
// bayat sayılmaz (sözleşme geriye dönük: yalnız bilgi eksilir, kırmızı üretilmez).
// =============================================================================
import { safeFormat } from "@/lib/format";
import type { OffsiteStatus } from "./service";

export type OffsiteCardState = "yok" | "sorun" | "iyi";

export interface OffsiteCardView {
  state: OffsiteCardState;
  /** "Son başarılı kopya: 22.09 02:13 (3 sa önce)" ya da "henüz yok" cümlesi. */
  lastOkLine: string;
  /** Yalnız bayatken: "N saattir uzak kopya alınamıyor · 3 ardışık hata: <neden>". */
  staleLine: string | null;
}

/** İnsan ölçeği: dakika → saat → gün. Panel yalnız kabaca "ne kadar oldu" sorar. */
export function relativeAgo(from: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} dk önce`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

export function offsiteCardView(o: OffsiteStatus["offsite"], now = new Date()): OffsiteCardView {
  const missing = o.missingCount ?? 0;
  const stale = o.stale === true;
  const state: OffsiteCardState = !o.configured ? "yok" : o.ok && missing === 0 && !stale ? "iyi" : "sorun";

  const lastOk = o.lastOkAt ? new Date(o.lastOkAt) : null;
  const lastOkLine = lastOk && !Number.isNaN(lastOk.getTime())
    ? `Son başarılı kopya: ${safeFormat(lastOk, "dd.MM HH:mm")} (${relativeAgo(lastOk, now)})`
    : "Henüz hiç başarılı uzak kopya yok.";

  let staleLine: string | null = null;
  if (state !== "yok" && stale) {
    const since = lastOk ? relativeAgo(lastOk, now).replace(" önce", "dir") : "hiçbir zaman";
    const fails = (o.consecutiveFailures ?? 0) > 0 ? ` · ${o.consecutiveFailures} ardışık hata` : "";
    const reason = o.lastError ? `: ${o.lastError}` : "";
    staleLine = lastOk
      ? `${since} uzak kopya alınamıyor${fails}${reason}`
      : `Uzak kopya ${since} başarılı olmadı${fails}${reason}`;
  }
  return { state, lastOkLine, staleLine };
}
