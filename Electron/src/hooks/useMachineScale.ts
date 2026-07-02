import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { usePreferencesOptional } from "@/providers/PreferencesProvider";

/** Kantar satırı (HAL okuması için protokol dahil) — yerel prefs veya backend kaydından. */
export interface DeviceScale {
  id: string;
  code: string;
  name: string;
  connectionType: string;
  address: string | null;
  port: number | null;
  pollCommand: string | null;
  terminator: string | null;
  decimals: number | null;
  scale: number | string | null; // backend Decimal → number|string serialize edebilir
  unit: string | null;
  timeoutMs: number | null;
  role: string | null;
  simulate: boolean;
}

/**
 * Bu PC'nin kantarı — ÖNCELİK: yerel tercih (Genel Ayarlar → Cihazlar → Sevkiyat
 * Kantarı; kantar bu PC'ye USB/seri bağlı, backend'e uğramaz — çalışma oturumu
 * modeli). Yerel tanım yoksa GEÇİŞ fallback'i eski for-device çözümü (bu PC'nin
 * Device.machineId ataması; Faz 6'da backend ucuyla birlikte kalkar).
 *
 * YALNIZ seri-okunabilir cihazlar (SERIAL_COM/USB) — Electron PC kantarı COM
 * portundan okur (window.api.scale.read). BT-SPP kantar telefon yoludur.
 */
const SERIAL_CONNECTIONS = ["SERIAL_COM", "USB"];

export function useMachineScale(): { scale: DeviceScale | null; isLoading: boolean } {
  const prefsCtx = usePreferencesOptional();
  const local = prefsCtx?.prefs.scaleDevice;
  const hasLocal = !!local?.path || !!local?.simulate;

  const q = useQuery({
    queryKey: ["peripherals", "for-device", "SCALE"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: DeviceScale[] }>("/api/peripherals/for-device", {
        params: { kind: "SCALE" },
      });
      return res.data?.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: !hasLocal, // yerel tanım varsa backend'e hiç sorma
  });

  if (hasLocal && local) {
    return {
      scale: {
        id: "local-scale",
        code: "LOCAL",
        name: "Sevkiyat Kantarı (bu PC)",
        connectionType: "SERIAL_COM",
        address: local.path ?? null,
        // readWeightFromScale `port` alanını baudRate olarak kullanır (seri okuma).
        port: local.baudRate ?? null,
        pollCommand: local.pollCommand ?? null,
        terminator: local.terminator ?? null,
        decimals: local.decimals ?? null,
        scale: local.factor ?? null,
        unit: "kg",
        timeoutMs: local.timeoutMs ?? null,
        role: "PRIMARY",
        simulate: local.simulate ?? false,
      },
      isLoading: false,
    };
  }

  const rows = (q.data ?? []).filter((r) => SERIAL_CONNECTIONS.includes(r.connectionType));
  const scale = rows.find((r) => r.role === "PRIMARY") ?? rows[0] ?? null;
  return { scale, isLoading: q.isLoading };
}
