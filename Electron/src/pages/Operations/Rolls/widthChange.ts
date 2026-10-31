// D4-E2b: top geçmişinde EN DEĞİŞİMİ satırı. İz backend'de adım bitiş satırının
// (`RollOperation.metadata.widthBefore/widthAfter`, D4-E2a) içindedir; geçmiş ucu
// metadata'yı `details.metadata` olarak taşır. Saat fabrika diliminden (safeFormat).
import { formatNumber, safeFormat } from "@/lib/format";
import type { RollHistoryEvent } from "./service";

export interface WidthChange {
  widthBefore: number | null;
  widthAfter: number;
}

/** Olaydan en izini okur; iz yoksa (eski satır, en ölçülmeyen adım) null. */
export function readWidthChange(ev: Pick<RollHistoryEvent, "details">): WidthChange | null {
  const md = (ev.details as { metadata?: unknown } | null)?.metadata;
  if (!md || typeof md !== "object" || Array.isArray(md)) return null;
  const m = md as Record<string, unknown>;
  if (typeof m.widthAfter !== "number") return null;
  return { widthBefore: typeof m.widthBefore === "number" ? m.widthBefore : null, widthAfter: m.widthAfter };
}

const fmtCm = (n: number): string => formatNumber(n, Number.isInteger(n) ? 0 : Number.isInteger(n * 10) ? 1 : 2);

/** "En 300 → 280 cm, <istasyon>, <kişi>, <saat>" — eksik parça atlanır; iz yoksa null. */
export function widthChangeLine(ev: RollHistoryEvent): string | null {
  const w = readWidthChange(ev);
  if (!w) return null;
  const head = w.widthBefore == null ? `En ${fmtCm(w.widthAfter)} cm ölçüldü` : `En ${fmtCm(w.widthBefore)} → ${fmtCm(w.widthAfter)} cm`;
  return [head, ev.stationName, ev.operatorName, safeFormat(ev.at, "dd.MM.yyyy HH:mm")].filter(Boolean).join(", ");
}
