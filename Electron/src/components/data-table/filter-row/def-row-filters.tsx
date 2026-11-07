import { FilterControl, type FilterDef } from "../FilterBar";
import { DatePresetFilter } from "./DatePresetFilter";
import { filterKeysOf, keysWithDependents, type RowFilter } from "./row-filter";
import type { TableFilterPersistConfig } from "./filter-persist";

type KeyedDef = Exclude<FilterDef, { kind: "dateRange" }>;
type DateDef = Extract<FilterDef, { kind: "dateRange" }>;

/** FilterBar tanımı → tek satır kutusu (✕ bağımlı çocukları da siler). */
export function defRowFilter(def: KeyedDef, all: readonly FilterDef[]): RowFilter {
  return { id: def.key, label: def.label, keys: keysWithDependents(def, all), render: ({ autoOpen }) => <FilterControl def={def} chip autoOpen={autoOpen} /> };
}

export function dateRowFilter(def: DateDef, past?: { field: string; label: string }): RowFilter {
  return { id: "date", label: def.label, keys: ["dateField", "dateFrom", "dateTo"], render: ({ autoOpen }) => <DatePresetFilter def={def} past={past} autoOpen={autoOpen} /> };
}

/** Tanımları satırda duranlar (`primaryKeys` sırasıyla, varsa tarih başta) ve "+ Filtre" altındakiler olarak ayırır. */
export function splitDefFilters(filters: readonly FilterDef[], primaryKeys: readonly string[], opts: { datePrimary?: boolean } = {}) {
  const date = filters.find((f): f is DateDef => f.kind === "dateRange");
  const keyed = filters.filter((f): f is KeyedDef => f.kind !== "dateRange");
  const dateRow = date ? [dateRowFilter(date)] : [];
  const primary = [...(opts.datePrimary === false ? [] : dateRow), ...primaryKeys.flatMap((k) => keyed.filter((d) => d.key === k).map((d) => defRowFilter(d, filters)))];
  const more = [...(opts.datePrimary === false ? dateRow : []), ...keyed.filter((d) => !primaryKeys.includes(d.key)).map((d) => defRowFilter(d, filters))];
  return { primary, more };
}

/** Kalıcı yerel anahtar ("Tamamlananlar dahil"): "+ Filtre"den açılır, ✕/Temizle varsayılana (gizli) döndürür. */
export function localToggleRowFilter(id: string, label: string, on: boolean, set: (v: boolean) => void): RowFilter {
  return { id, label, keys: [], active: on, onClear: () => set(false), onAdd: () => set(true), render: () => <span className="px-2 text-xs">{label}</span> };
}

/** URL'deki anahtar ("İptaller dahil"): kayda ve kayıtlı görünüme girer; ✕/Temizle tek URL yazımıyla siler. */
export function urlToggleRowFilter(id: string, label: string, urlKey: string, set: (v: boolean) => void): RowFilter {
  return { id, label, keys: [urlKey], onAdd: () => set(true), render: () => <span className="px-2 text-xs">{label}</span> };
}

/** Kayıt allowlist'i: tanımların `filter[...]` anahtarları + sayfanın ek anahtarları. */
export function persistConfigOf(filters: readonly FilterDef[], extra: Partial<TableFilterPersistConfig> & { extraFilterKeys?: readonly string[] } = {}): TableFilterPersistConfig {
  const filterKeys = [...filters.flatMap(filterKeysOf).filter((k) => k.startsWith("filter[")), ...(extra.extraFilterKeys ?? [])];
  return { filterKeys, extraKeys: extra.extraKeys, defaultDate: extra.defaultDate };
}
