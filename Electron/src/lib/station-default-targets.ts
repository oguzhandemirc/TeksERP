// =============================================================================
// İSTASYON VARSAYILAN HEDEFLERİ — panel okuma noktası (K22)
// =============================================================================
// Kural sunucuda (`helpers/station-default-targets.helper`, uç `/api/station-capabilities/default-targets`):
// AUTO bayrak hep, OPTIONAL yalnız "varsayılan açık", değer müşteri > yetenek > isDefault. Panel kuralı YAZMAZ;
// yalnız cevabı form alanlarına (hedef bayraklar · kurşun gramajı · kat) eşler. Uç yoksa/hata → ön seçim yok.
// =============================================================================
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface DefaultTarget {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  valueType: "FLAG" | "CHOICE";
  mode: "AUTO" | "OPTIONAL" | "REQUIRED";
  variantOfPropertyId: string | null;
  valueId: string | null;
  valueCode: string | null;
  valueName: string | null;
  source: "CUSTOMER" | "STATION" | "VALUE_DEFAULT" | null;
}

/** stationId → ön seçim listesi. Anahtarı olmayan istasyon = henüz okunmadı. */
export type DefaultTargetsByStation = Readonly<Record<string, readonly DefaultTarget[]>>;

export async function fetchStationDefaultTargets(stationIds: readonly string[], customerId: string | null): Promise<DefaultTargetsByStation> {
  const res = await apiClient.get<{ success: true; data: Array<{ stationId: string; targets: DefaultTarget[] }> }>(
    "/api/station-capabilities/default-targets",
    { params: { stationIds: stationIds.join(","), ...(customerId ? { customerId } : {}) } },
  );
  return Object.fromEntries((res.data.data ?? []).map((r) => [r.stationId, r.targets]));
}

/**
 * Rota adımlarının istasyonları için ön seçim. `failed` = uç okunamadı (eski sunucu/yetki) → çağıran "boş" sayar.
 * Önceki cevap yeni adım okunurken tutulur (eski istasyonlar titremez); yeni istasyon anahtarı gelene dek bekler.
 */
export function useStationDefaultTargets(stationIds: readonly string[], customerId: string | null, enabled: boolean) {
  const ids = [...new Set(stationIds.filter(Boolean))].sort();
  const q = useQuery({
    queryKey: ["station-capabilities", "default-targets", ids.join(","), customerId ?? ""],
    queryFn: () => fetchStationDefaultTargets(ids, customerId),
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  return { byStation: q.data ?? null, failed: q.isError };
}
