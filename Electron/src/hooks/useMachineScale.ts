import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

/** for-device çözümünden dönen kantar satırı (HAL okuması için protokol dahil). */
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
 * Bu PC'nin atandığı makinenin kantarı (PeripheralDevice/SCALE). Backend
 * `x-device-id` → Device → Machine çözer; atanmamışsa boş liste → null.
 *
 * YALNIZ seri-okunabilir cihazlar (SERIAL_COM/USB) — Electron PC kantarı COM
 * portundan okur. BT-SPP kantar (telefon yolu) bu PC'de okunamaz, atlanır →
 * yalnızca telefon kullanılan kurulumda Electron "Tart" dormant kalır (net hata).
 * role PRIMARY ?? ilk satır.
 */
const SERIAL_CONNECTIONS = ["SERIAL_COM", "USB"];

export function useMachineScale(): { scale: DeviceScale | null; isLoading: boolean } {
  const q = useQuery({
    queryKey: ["peripherals", "for-device", "SCALE"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: DeviceScale[] }>("/api/peripherals/for-device", {
        params: { kind: "SCALE" },
      });
      return res.data?.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const rows = (q.data ?? []).filter((r) => SERIAL_CONNECTIONS.includes(r.connectionType));
  const scale = rows.find((r) => r.role === "PRIMARY") ?? rows[0] ?? null;
  return { scale, isLoading: q.isLoading };
}
