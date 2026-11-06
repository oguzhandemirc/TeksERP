// =============================================================================
// TEK SATIR FİLTRE ÇUBUĞU — saf model (2026-11-06)
// =============================================================================
// Her kutu bir `RowFilter`dır: hangi URL anahtarlarını taşıdığını bilir; ✕ ve
// "Temizle" yalnız bu anahtarları siler. Süzme SUNUCUDA — çubuk yalnız URL yazar,
// liste/cursor/özet şeridi aynı where'den okur (`docs/kurallar/filtre-liste.md`).
// =============================================================================
import type { ReactNode } from "react";
import type { FilterDef } from "../FilterBar";

export interface RowFilter {
  id: string;
  /** Kutu ve "+ Filtre" menüsündeki ad. */
  label: string;
  /** URL anahtarları — ✕/Temizle bunları siler; biri doluysa kutu etkin. */
  keys: readonly string[];
  /** URL dışı durum (ör. yerel anahtar): verilirse etkinliği bu söyler. */
  active?: boolean;
  /** URL dışı durumu sıfırlar (✕/Temizle). */
  onClear?: () => void;
  /** "+ Filtre"den seçilince kutu açmadan doğrudan etkinleşir (ör. "İptaller dahil"). */
  onAdd?: () => void;
  render: (ctx: { autoOpen: boolean }) => ReactNode;
}

/** `dateField` tek başına süzmez (yalnız hangi tarih kolonu) — etkinliği belirlemez. */
const PASSIVE_KEYS = new Set(["dateField"]);

export function filterKeysOf(def: FilterDef): string[] {
  if (def.kind === "dateRange") return ["dateField", "dateFrom", "dateTo"];
  if (def.kind === "numberRange") return [`filter[${def.key}Min]`, `filter[${def.key}Max]`];
  return [`filter[${def.key}]`];
}

/**
 * Bağımlı süzgeç (müşteri → şube) üst kutusu ✕ ile kalkınca çocuğu da gider: bayat
 * şube yeni müşteride yok, boş sonuç verirdi. Üst kutunun anahtarlarına çocuklar eklenir.
 */
export function keysWithDependents(def: FilterDef, all: readonly FilterDef[]): string[] {
  const own = filterKeysOf(def);
  if (def.kind === "dateRange") return own;
  const kids = all.filter((d) => d.kind === "dependent-lookup" && d.dependsOn === def.key);
  return [...own, ...kids.flatMap(filterKeysOf)];
}

export function isRowFilterActive(f: RowFilter, sp: URLSearchParams): boolean {
  if (f.active !== undefined) return f.active;
  return f.keys.some((k) => !PASSIVE_KEYS.has(k) && Boolean(sp.get(k)));
}

/** Verilen anahtarları siler; yeni süzgeçle eski sayfa anlamsız (cursor/page da gider). */
export function withoutKeys(sp: URLSearchParams, keys: Iterable<string>): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const k of keys) next.delete(k);
  next.delete("cursor");
  next.delete("page");
  return next;
}

/** "Temizle": etkin kutuların anahtarları birlikte, TEK URL yazımıyla (arama metni kalır). */
export function clearAllKeys(filters: readonly RowFilter[], sp: URLSearchParams): string[] {
  return filters.filter((f) => isRowFilterActive(f, sp)).flatMap((f) => f.keys);
}
