// =============================================================================
// LİSTE FİLTRE KAYDI — saf model (kullanıcı başına, tablo anahtarı başına)
// =============================================================================
// Sayfaya dönünce SON KULLANILAN süzgeç + sıralama gelir; arama metni, sayfa/cursor,
// sekme gibi anahtarlar kaydedilmez. Hazır tarih seçimi ("Son 7 gün") GÖRELİ saklanır
// (`datePreset`), elle seçilen aralık mutlak kalır. Kayıt `prefs.tableFilters[tableKey]`.
// Okurken her şey süzülür: bozuk/eskimiş kayıt sayfayı kilitlemez, yok sayılır.
// =============================================================================
import { applyDatePreset, readDatePreset, type DatePresetId } from "./date-preset";

export interface TableFilterPersistConfig {
  /** Kaydedilebilir `filter[...]` anahtarları; verilmezse her `filter[...]` geçer. */
  filterKeys?: readonly string[];
  /** URL'de duran ek süzgeç anahtarları (ör. `showCancelled`). */
  extraKeys?: readonly string[];
  /** Kayıt yokken uygulanan göreli tarih (bugünkü "son 30 gün" varsayılanı); "Tümü" seçimi o zaman `datePreset=all` saklanır. */
  defaultDate?: { field: string; preset: DatePresetId };
}

export interface StoredTableFilter {
  query: string;
  savedAt: string;
}

const BASE_KEYS = ["sortBy", "sortOrder", "dateField", "dateFrom", "dateTo"];
const RELATIVE_PRESETS = new Set<DatePresetId>(["today", "last7", "last30", "past"]);
export const DATE_PRESET_PARAM = "datePreset";
/** Tercih blob'u 64KB ile sınırlı (backend); tek tablo kaydı bunun küçük bir parçası kalır. */
export const MAX_STORED_QUERY = 2000;

export function isPersistedKey(key: string, cfg: TableFilterPersistConfig): boolean {
  if (BASE_KEYS.includes(key)) return true;
  if (cfg.extraKeys?.includes(key)) return true;
  if (/^filter\[.+\]$/.test(key)) return cfg.filterKeys ? cfg.filterKeys.includes(key) : true;
  return false;
}

/** URL'nin kaydedilen alt kümesi — mutlak, anahtar sıralı (karşılaştırma için kararlı). */
export function persistedSubset(sp: URLSearchParams, cfg: TableFilterPersistConfig): URLSearchParams {
  const out = new URLSearchParams();
  [...sp.entries()]
    .filter(([k, v]) => v !== "" && isPersistedKey(k, cfg))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .forEach(([k, v]) => out.append(k, v));
  // `dateField` tek başına süzmez (yalnız hangi kolon) — taşınmaz.
  if (!out.has("dateFrom") && !out.has("dateTo")) out.delete("dateField");
  return out;
}

/** Başka ekrandan gelen bağlantının taşıdığı, kaydedilmeyen anahtarlar (genel arama, kayda odak). */
const DEEP_LINK_KEYS = ["search", "focus"];

/** Derin bağlantı: kaydedilen bir anahtar ya da arama/odak varsa kayıtlı süzgeç uygulanmaz. */
export function isDeepLink(sp: URLSearchParams, cfg: TableFilterPersistConfig): boolean {
  return persistedSubset(sp, cfg).toString() !== "" || DEEP_LINK_KEYS.some((k) => Boolean(sp.get(k)));
}

/** Saklanacak biçim: hazır tarih seçimi göreli (`datePreset=last7`), gerisi olduğu gibi. */
export function encodeForStore(sp: URLSearchParams, cfg: TableFilterPersistConfig, now: Date = new Date()): string {
  const sub = persistedSubset(sp, cfg);
  if (sub.has("dateFrom") || sub.has("dateTo")) {
    const st = readDatePreset(sub, sub.get("dateField") ?? "", now);
    if (RELATIVE_PRESETS.has(st.id) && st.field) {
      sub.delete("dateFrom");
      sub.delete("dateTo");
      sub.set(DATE_PRESET_PARAM, st.id);
    }
  } else if (cfg.defaultDate) {
    sub.set(DATE_PRESET_PARAM, "all");
  }
  return sub.toString();
}

const validIso = (v: string | null) => v !== null && !Number.isNaN(new Date(v).getTime());

/**
 * Kayıt → URL'ye yazılacak alt küme (mutlak). Fail-safe: biçim bozuksa `null`; tanınmayan
 * ya da kaldırılmış anahtar, geçersiz tarih/yön sessizce düşer.
 */
export function decodeStored(raw: unknown, cfg: TableFilterPersistConfig, now: Date = new Date()): URLSearchParams | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const query = (raw as { query?: unknown }).query;
    if (typeof query !== "string" || query.length > MAX_STORED_QUERY) return null;
    const src = new URLSearchParams(query);
    let out = new URLSearchParams();
    src.forEach((v, k) => {
      if (v !== "" && isPersistedKey(k, cfg)) out.append(k, v);
    });
    if (out.has("sortOrder") && !["asc", "desc"].includes(out.get("sortOrder") ?? "")) out.delete("sortOrder");
    if (out.has("dateFrom") && !validIso(out.get("dateFrom"))) out.delete("dateFrom");
    if (out.has("dateTo") && !validIso(out.get("dateTo"))) out.delete("dateTo");
    const preset = src.get(DATE_PRESET_PARAM) as DatePresetId | null;
    const field = out.get("dateField");
    if (preset && RELATIVE_PRESETS.has(preset) && field) {
      out = applyDatePreset(out, { id: preset, field, from: "", to: "" }, now);
    }
    return persistedSubset(out, cfg);
  } catch {
    return null;
  }
}

/** Kayıt yokken (ya da okunamazken) uygulanacak alt küme: yalnız varsayılan tarih, yoksa boş. */
export function defaultSubset(cfg: TableFilterPersistConfig, now: Date = new Date()): URLSearchParams {
  const d = cfg.defaultDate;
  if (!d) return new URLSearchParams();
  return persistedSubset(applyDatePreset(new URLSearchParams(), { id: d.preset, field: d.field, from: "", to: "" }, now), cfg);
}

/** Tercih haritasına tek tablonun kaydını yazar; boş sorgu kaydı siler (Temizle = sıfır). */
export function withStoredEntry(map: unknown, tableKey: string, query: string, now: Date = new Date()): Record<string, StoredTableFilter> {
  const base: Record<string, StoredTableFilter> =
    map && typeof map === "object" && !Array.isArray(map) ? { ...(map as Record<string, StoredTableFilter>) } : {};
  if (query) base[tableKey] = { query, savedAt: now.toISOString() };
  else delete base[tableKey];
  return base;
}

/** Saklı kaydın sorgusu (biçim bozuksa ""). */
export function storedQuery(map: unknown, tableKey: string): string {
  if (!map || typeof map !== "object") return "";
  const q = (map as Record<string, { query?: unknown } | undefined>)[tableKey]?.query;
  return typeof q === "string" ? q : "";
}

/** Geri yüklenecek alt küme: okunabilen kayıt, yoksa sayfanın varsayılanı (kayıtlı "Tümü" boş döner). */
export function restoredSubset(raw: unknown, cfg: TableFilterPersistConfig, now: Date = new Date()): URLSearchParams {
  return (raw === undefined ? null : decodeStored(raw, cfg, now)) ?? defaultSubset(cfg, now);
}

/**
 * Sayfa içi sekme geçişi (tablo anahtarı değişti): eski ve yeni tablonun kaydedilen anahtarları
 * URL'den çıkar, yeni tablonun kaydı eklenir — bir sekmenin süzgeci ötekine taşınmaz.
 * Config'i olmayan tablo (ör. Üretim Akışı) yalnız eski süzgeci temizler.
 */
export function switchTableUrl(
  sp: URLSearchParams,
  prevCfg: TableFilterPersistConfig | undefined,
  nextCfg: TableFilterPersistConfig | undefined,
  raw: unknown,
): { next: URLSearchParams; restored: boolean } {
  const owned = (k: string) => Boolean((prevCfg && isPersistedKey(k, prevCfg)) || (nextCfg && isPersistedKey(k, nextCfg)));
  const next = new URLSearchParams(sp);
  for (const k of [...next.keys()]) if (owned(k)) next.delete(k);
  next.delete("cursor");
  next.delete("page");
  const restored = nextCfg ? restoredSubset(raw, nextCfg) : new URLSearchParams();
  restored.forEach((v, k) => next.append(k, v));
  return { next, restored: restored.toString() !== "" };
}
