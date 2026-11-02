import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { loadAllForPicker } from "@/lib/picker-loader";

interface Props {
  /** Adımın istasyonu — yalnız onun aktif makineleri önerilir (backend aynı kuralı doğrular). */
  stationId: string;
  value: string | null;
  onChange: (machineId: string | null) => void;
  disabled?: boolean;
}

export const plannedMachinesKey = (stationId: string) => ["machines", "planned", stationId] as const;

/**
 * Plan makinesi (Gülkesim 2026-11-02) — yalnız ÖNERİ; fiilî makine tablet oturumundan gelir.
 * Birkaç makine olduğu için düğme dizisi (UI tercihi: combobox yok). Makine yoksa hiç çizilmez.
 */
export function PlannedMachineButtons({ stationId, value, onChange, disabled }: Props) {
  const q = useQuery({
    queryKey: plannedMachinesKey(stationId),
    queryFn: async () =>
      ((await loadAllForPicker(machineService, { filters: { stationId, isActive: "true" } })).data ?? []) as Machine[],
    staleTime: 60_000,
  });
  const machines = q.data ?? [];
  if (machines.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Makine (öneri)">
      <Button
        type="button"
        size="sm"
        role="radio"
        aria-checked={value === null}
        variant={value === null ? "default" : "outline"}
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        Öneri yok
      </Button>
      {machines.map((m) => (
        <Button
          key={m.id}
          type="button"
          size="sm"
          role="radio"
          aria-checked={value === m.id}
          variant={value === m.id ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onChange(m.id)}
        >
          {m.name}
        </Button>
      ))}
    </div>
  );
}
