// TEZGAH ALARMI — query anahtar fabrikası ([MO-27]); `invalidateQueries` aynı kökten okur.
export const loomAlarmKeys = {
  all: ['loom-alarms'] as const,
  feed: (p: { mine: boolean; machineId?: string }) => ['loom-alarms', 'feed', p.mine, p.machineId ?? null] as const,
  detail: (id: string) => ['loom-alarms', 'detail', id] as const,
};
