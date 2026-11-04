import type { FilterDef } from "@/components/data-table/FilterBar";
import { foldedIncludes } from "@/lib/search-fold";
import { TERIM } from "@/lib/terim";
import { buildScopeQueryString } from "@/lib/query-builder";
import type { ListScope } from "@/types/api";

// ── "Şu an hangi fasonda" (2026-11-04) ───────────────────────────────────────
// Değer = fason firma UUID'si (CSV); sunucu diğer süzgeçlerle VE'ler, tanımadığı
// değere 400 INVALID_FILTER_VALUE döner. Anlam ŞU AN orada olan top, plan değil.
// "Hangi aşamada" sorusu Durum menüsündeki `konumIstasyon` grubunundur (ikinci seçici yok).
export const FASON_FIRMA_FILTER_KEY = "fasonFirma";
export const PLACE_FILTER_KEYS = [FASON_FIRMA_FILTER_KEY] as const;

export interface PlaceOption {
  id: string;
  name: string;
  workOrderCount: number;
}
export interface PlaceOptions {
  firms: PlaceOption[];
}

/** Seçenek satırı: "NY Hisar · 7" — sayı şu an orada olan iş emri. */
export function placeOptionLabel(it: { id: string; name?: string; workOrderCount?: number }): string {
  const name = it.name ?? it.id;
  return typeof it.workOrderCount === "number" ? `${name} · ${it.workOrderCount}` : name;
}

/**
 * Seçenek ucu küçük → tek istek, arama İSTEMCİDE (Türkçe katlamalı); kısa ömürlü önbellek.
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
  return {
    firms: {
      getAll: async (params: { search?: string }) => {
        const data = (await load()).firms.filter((o) => foldedIncludes(o.name, params.search ?? ""));
        return {
          success: true,
          data,
          pagination: { page: 1, pageSize: data.length, total: data.length, totalPages: 1 },
        };
      },
    },
  };
}

/** Önbellek anahtarı kapsamı içerir → süzgeç/tarih/arama değişince seçenekler yeniden çekilir. */
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
      emptyText: `Şu an fasonda ${TERIM.terbiyeIsEmri.tekilKucuk} yok.`,
    },
  ];
}

/** Sunucu seçilen firmayı tanımadı mı (silinmiş/eski bağlantı)? */
export function isInvalidFilterValueError(err: unknown): boolean {
  const code = (err as { response?: { data?: { details?: { code?: unknown } } } } | null)?.response?.data
    ?.details?.code;
  return code === "INVALID_FILTER_VALUE";
}

/** Yer süzgecini URL'den atar; değişiklik yoksa null (gereksiz yazım/döngü olmasın). */
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
