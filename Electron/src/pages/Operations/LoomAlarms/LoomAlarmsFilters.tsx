// Alarmlar listesi süzgeçleri — kapsam · kademe · hol · sebep · oluşma günü. Süzme SUNUCUDA:
// süzgeç durumu liste parametresine birebir çevrilir (`toListParams`), cursor ve özet şeridi aynı where.
import { useQuery } from "@tanstack/react-query";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { loadAllForPicker } from "@/lib/picker-loader";
import { stationService } from "@/pages/Stations/service";
import { useStopReasonPresets } from "@/pages/Operations/MachineStops/useStopReasonPresets";
import type { LoomAlarmListParams, LoomAlarmScope } from "./types";

export interface AlarmFilterState {
  scope: LoomAlarmScope;
  tier: "" | "1" | "2";
  stationId: string;
  reasonCode: string;
  from: string;
  to: string;
}

export const INITIAL_ALARM_FILTERS: AlarmFilterState = { scope: "active", tier: "", stationId: "", reasonCode: "", from: "", to: "" };

/** Süzgeç → sunucu parametresi (boş alan gönderilmez; aktif kapsamda tarih aralığı yok). */
export function toListParams(f: AlarmFilterState): LoomAlarmListParams {
  const p: LoomAlarmListParams = { scope: f.scope };
  if (f.tier) p.tier = Number(f.tier) as 1 | 2;
  if (f.stationId) p.stationId = f.stationId;
  if (f.reasonCode) p.reasonCode = f.reasonCode;
  if (f.scope !== "active" && f.from) p.from = f.from;
  if (f.scope !== "active" && f.to) p.to = f.to;
  return p;
}

function useWeavingHalls(enabled: boolean) {
  const q = useQuery({
    queryKey: ["loom-alarms", "halls"],
    queryFn: () => loadAllForPicker(stationService),
    enabled,
    staleTime: 5 * 60_000,
  });
  return (q.data?.data ?? []).filter((s) => s.kind === "WEAVING");
}

interface Props {
  value: AlarmFilterState;
  onChange: (next: AlarmFilterState) => void;
}

const SCOPES: { value: LoomAlarmScope; label: string }[] = [
  { value: "active", label: "Aktif" },
  { value: "history", label: "Geçmiş" },
  { value: "all", label: "Tümü" },
];
const TIERS: { value: "1" | "2"; label: string }[] = [
  { value: "1", label: "Görevliye bildirildi" },
  { value: "2", label: "Patrona iletildi" },
];

/** Tek satır süzgeç kutuları ("Kademe: Tümü ▾"); üstte etiket + altta açılır düzeni yok (2026-11-23). */
export function LoomAlarmsFilters({ value, onChange }: Props) {
  const { hasPermission } = useRoleAccess();
  const halls = useWeavingHalls(hasPermission("station:read"));
  const { active: reasons } = useStopReasonPresets();
  const set = (patch: Partial<AlarmFilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SelectChip id="alarm-scope" label="Görünüm" value={value.scope} resetValue="active" options={SCOPES} onChange={(v) => set({ scope: v ?? "active" })} />
      <SelectChip id="alarm-tier" label="Kademe" value={value.tier || null} options={TIERS} onChange={(v) => set({ tier: v ?? "" })} />
      {halls.length > 0 && (
        <SelectChip id="alarm-hall" label="Hol" value={value.stationId || null} options={halls.map((h) => ({ value: h.id, label: h.name }))} onChange={(v) => set({ stationId: v ?? "" })} />
      )}
      {reasons.length > 0 && (
        <SelectChip id="alarm-reason" label="Sebep" value={value.reasonCode || null} options={reasons.map((r) => ({ value: r.code, label: r.label }))} onChange={(v) => set({ reasonCode: v ?? "" })} />
      )}
      {value.scope !== "active" && <DayRangeChip id="alarm-day" label="Gün" from={value.from} to={value.to} onChange={(r) => set(r)} />}
    </div>
  );
}
