// Alarmlar listesi süzgeçleri — kapsam · kademe · hol · sebep · oluşma günü. Süzme SUNUCUDA:
// süzgeç durumu liste parametresine birebir çevrilir (`toListParams`), cursor ve özet şeridi aynı where.
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
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

const ALL = "__all__";

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

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger className="w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tümü</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function LoomAlarmsFilters({ value, onChange }: Props) {
  const { hasPermission } = useRoleAccess();
  const halls = useWeavingHalls(hasPermission("station:read"));
  const { active: reasons } = useStopReasonPresets();
  const set = (patch: Partial<AlarmFilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Tabs value={value.scope} onValueChange={(v) => set({ scope: v as LoomAlarmScope })}>
        <TabsList>
          <TabsTrigger value="active">Aktif</TabsTrigger>
          <TabsTrigger value="history">Geçmiş</TabsTrigger>
          <TabsTrigger value="all">Tümü</TabsTrigger>
        </TabsList>
      </Tabs>
      <Pick
        label="Kademe"
        value={value.tier}
        onChange={(v) => set({ tier: v as AlarmFilterState["tier"] })}
        options={[
          { value: "1", label: "Görevliye bildirildi" },
          { value: "2", label: "Patrona iletildi" },
        ]}
      />
      {halls.length > 0 && <Pick label="Hol" value={value.stationId} onChange={(v) => set({ stationId: v })} options={halls.map((h) => ({ value: h.id, label: h.name }))} />}
      {reasons.length > 0 && <Pick label="Sebep" value={value.reasonCode} onChange={(v) => set({ reasonCode: v })} options={reasons.map((r) => ({ value: r.code, label: r.label }))} />}
      {value.scope !== "active" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="alarm-from">Başlangıç günü</Label>
            <DatePickerInput id="alarm-from" value={value.from} onChange={(v) => set({ from: v })} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alarm-to">Bitiş günü</Label>
            <DatePickerInput id="alarm-to" value={value.to} onChange={(v) => set({ to: v })} invalid={Boolean(value.from && value.to && value.to < value.from)} className="w-40" />
          </div>
        </>
      )}
    </div>
  );
}
