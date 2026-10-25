// Sistem raporunun ön ayarları (R1-KAYIT uçları): sayfa kendi SISTEM tanımını katalog anahtarıyla bulur,
// ön ayar = URL'deki parametre takımı. Veri kaydedilmez — uygulanan ön ayar raporu CANLI yeniden çalıştırır.
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

const BASE = "/api/rapor-tanimlari";
/** Sunucunun sistem ön ayarı anahtar kuralı (`rapor-on-ayar.service` systemParams) — dışı gönderilmez. */
const PARAM_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const MAX_PARAMS = 20;

export interface ReportPreset {
  id: string;
  ad: string;
  parametreler: Record<string, unknown>;
  paylasimli: boolean;
  varsayilan: boolean;
  sahip: string;
  benim: boolean;
}

const data = <T,>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export const presetApi = {
  /** Katalog anahtarının SISTEM tanımı; yoksa (tanım tohumlanmamış) null. */
  systemDefinitionId: (key: string) =>
    data<{ items: Array<{ id: string; tur: string }> }>(apiClient.get(BASE, { params: { kapsam: "sistem", anahtar: key, limit: 1 }, suppressErrorToast: true })).then(
      (r) => r.items.find((d) => d.tur === "SISTEM")?.id ?? null,
    ),
  list: (definitionId: string) => data<ReportPreset[]>(apiClient.get(`${BASE}/${definitionId}/on-ayarlar`, { suppressErrorToast: true })),
  create: (definitionId: string, input: { ad: string; parametreler: Record<string, string>; paylasimli: boolean; varsayilan: boolean }) =>
    data<ReportPreset>(apiClient.post(`${BASE}/${definitionId}/on-ayarlar`, input)),
};

/** URL → ön ayar parametreleri (tarih dahil; boş değer ve sunucu kuralı dışındaki anahtar atlanır). */
export function presetParamsFromSearch(search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of search.entries()) {
    if (v === "" || !PARAM_KEY_RE.test(k) || Object.keys(out).length >= MAX_PARAMS) continue;
    out[k] = v.slice(0, 200);
  }
  return out;
}

const DATE_KEYS = new Set(["dateFrom", "dateTo", "asOf", "factoryDay"]);

/** URL'de tarih dışında seçim yok mu? (varsayılan ön ayar yalnız bu durumda uygulanır) */
export function onlyDateKeys(search: URLSearchParams): boolean {
  for (const k of search.keys()) if (!DATE_KEYS.has(k)) return false;
  return true;
}

/**
 * Ön ayar → URL: liste değeri virgülle (çiplerin CSV sözleşmesi); seçimler tümden değişir. Ön ayar tarih
 * taşımıyorsa bugünkü tarih anahtarları korunur — tarihsiz aralık raporu istek atamaz.
 */
export function searchFromPreset(params: Record<string, unknown>, current?: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const hasDate = Object.keys(params).some((k) => DATE_KEYS.has(k));
  if (current && !hasDate) for (const [k, v] of current.entries()) if (DATE_KEYS.has(k)) next.set(k, v);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    next.set(k, Array.isArray(v) ? v.map(String).join(",") : String(v));
  }
  return next;
}

export function useReportPresets(key: string) {
  const def = useQuery({ queryKey: ["report-system-definition", key], queryFn: () => presetApi.systemDefinitionId(key), staleTime: 5 * 60_000, retry: false });
  const definitionId = def.data ?? null;
  const presets = useQuery({
    queryKey: ["report-presets", definitionId],
    queryFn: () => presetApi.list(definitionId!),
    enabled: Boolean(definitionId),
    staleTime: 30_000,
    retry: false,
  });
  return { definitionId, definitionLoading: def.isLoading, presets: presets.data ?? [], presetsLoading: presets.isLoading && Boolean(definitionId) };
}
