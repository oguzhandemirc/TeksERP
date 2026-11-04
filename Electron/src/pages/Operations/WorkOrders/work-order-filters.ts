import type { FilterDef } from "@/components/data-table/FilterBar";
import { foldedIncludes } from "@/lib/search-fold";
import { buildScopeQueryString } from "@/lib/query-builder";
import type { ListScope } from "@/types/api";

/** "Fasonda" süzgecinin sunucu anahtarı — anlamı: en az bir topu şu an fasonda. */
export const FASONDA_FILTER_KEY = "fasonda";

/**
 * Durumdan AYRI süzgeç: sunucuda durum seçimiyle VE'lenir. Seçili değilken anahtar
 * istekte hiç yoktur ("Tümü" = URL'den silinir) — anahtarı tanımayan eski backend
 * (2.11.2) yalnız kullanıcı seçtiğinde görür. Dil satırdaki fason rozetiyle aynı.
 */
export const FASONDA_FILTER: FilterDef = {
  kind: "select",
  key: FASONDA_FILTER_KEY,
  label: "Fasonda",
  options: [{ value: "1", label: "Yalnız fasondakiler" }],
};

// ── "Şu an hangi fasonda / hangi aşamada" (panel 1.3.10) ─────────────────────
// Değer = firma / istasyon UUID'si (CSV); sunucu fasonda ve diğer süzgeçlerle VE'ler,
// tanımadığı değere 400 INVALID_FILTER_VALUE döner. Anlam ŞU AN orada olan top, plan değil.
export const FASON_FIRMA_FILTER_KEY = "fasonFirma";
export const ASAMA_FILTER_KEY = "asama";
export const PLACE_FILTER_KEYS = [FASON_FIRMA_FILTER_KEY, ASAMA_FILTER_KEY] as const;

export interface PlaceOption {
  id: string;
  name: string;
  workOrderCount: number;
}
export interface PlaceOptions {
  firms: PlaceOption[];
  stages: PlaceOption[];
}

/** Seçenek satırı: "NY Hisar · 7" — sayı şu an orada olan iş emri. */
export function placeOptionLabel(it: { id: string; name?: string; workOrderCount?: number }): string {
  const name = it.name ?? it.id;
  return typeof it.workOrderCount === "number" ? `${name} · ${it.workOrderCount}` : name;
}

/**
 * Seçenek ucu küçük (fason firma + istasyon) → tek istek, arama İSTEMCİDE (Türkçe katlamalı).
 * İki seçici aynı yanıtı paylaşır; kısa ömürlü önbellek açılışta çift isteği önler.
 * `scope` = listenin o anki kapsamı; uca AYNEN gider (sunucu faceted sayar).
 */
export function createPlaceLookupService(
  fetchOptions: (scope?: ListScope) => Promise<PlaceOptions>,
  ttlMs = 15_000,
  scope?: ListScope,
) {
  let cache: { at: number; promise: Promise<PlaceOptions> } | null = null;
  const load = () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const promise = fetchOptions(scope);
      cache = { at: Date.now(), promise };
      promise.catch(() => {
        if (cache?.promise === promise) cache = null;
      });
    }
    return cache.promise;
  };
  const serviceFor = (pick: (o: PlaceOptions) => PlaceOption[]) => ({
    getAll: async (params: { search?: string }) => {
      const all = pick(await load());
      const data = all.filter((o) => foldedIncludes(o.name, params.search ?? ""));
      return {
        success: true,
        data,
        pagination: { page: 1, pageSize: data.length, total: data.length, totalPages: 1 },
      };
    },
  });
  return { firms: serviceFor((o) => o.firms), stages: serviceFor((o) => o.stages) };
}

/**
 * Seçici önbellek anahtarı kapsamı içerir → süzgeç/tarih/arama değişince seçenekler
 * yeniden çekilir (iki seçici yine tek isteği paylaşır).
 */
export function buildPlaceFilters(
  fetchOptions: (scope?: ListScope) => Promise<PlaceOptions>,
  scope?: ListScope,
): FilterDef[] {
  const svc = createPlaceLookupService(fetchOptions, undefined, scope);
  const scopeKey = scope ? buildScopeQueryString(scope) : "";
  return [
    {
      kind: "multi-lookup",
      key: FASON_FIRMA_FILTER_KEY,
      label: "Şu an hangi fasonda",
      service: svc.firms,
      queryKey: `work-orders-where-options-firms${scopeKey}`,
      getLabel: placeOptionLabel,
      emptyText: "Şu an fasonda iş emri yok.",
    },
    {
      kind: "multi-lookup",
      key: ASAMA_FILTER_KEY,
      label: "Şu an hangi aşamada",
      service: svc.stages,
      queryKey: `work-orders-where-options-stages${scopeKey}`,
      getLabel: placeOptionLabel,
      emptyText: "Şu an üretim aşamasında iş emri yok.",
    },
  ];
}

/** Sunucu seçilen firma/aşamayı tanımadı mı (silinmiş/eski bağlantı)? */
export function isInvalidFilterValueError(err: unknown): boolean {
  const code = (err as { response?: { data?: { details?: { code?: unknown } } } } | null)?.response?.data
    ?.details?.code;
  return code === "INVALID_FILTER_VALUE";
}

/** Yer süzgeçlerini URL'den atar; değişiklik yoksa null (gereksiz yazım/döngü olmasın). */
export function stripPlaceFilters(sp: URLSearchParams): URLSearchParams | null {
  const next = new URLSearchParams(sp);
  let changed = false;
  for (const key of PLACE_FILTER_KEYS) {
    if (next.has(`filter[${key}]`)) {
      next.delete(`filter[${key}]`);
      changed = true;
    }
  }
  return changed ? next : null;
}
