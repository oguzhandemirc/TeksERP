// =============================================================================
// Makine başına listeler — açık koşumlar (koşum seçici) · bugünkü indirmeler
// =============================================================================
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doffService, type DoffListRow, type OpenMachineRun } from '../../../services/doff.service';

export const todayKey = (machineId: string) => ['doffs', 'today', machineId] as const;
export const runsKey = (machineId: string) => ['machine-runs', 'open', machineId] as const;

export function useDoffLists(machineId: string | null, lineNo: number) {
  const runsQuery = useQuery({
    queryKey: runsKey(machineId ?? ''),
    queryFn: () => doffService.listOpenRuns(machineId!),
    enabled: machineId != null,
    staleTime: 30_000,
  });
  const todayQuery = useQuery({
    queryKey: todayKey(machineId ?? ''),
    queryFn: () => doffService.listToday(machineId!),
    enabled: machineId != null,
    staleTime: 15_000,
  });
  const openRuns: OpenMachineRun[] = useMemo(
    () => (runsQuery.data?.data ?? []).filter((r) => r.productionLineNo === lineNo),
    [runsQuery.data, lineNo]
  );
  const todayRows: DoffListRow[] = todayQuery.data?.data ?? [];
  return {
    openRuns,
    runsLoading: runsQuery.isLoading,
    refetchRuns: () => void runsQuery.refetch(),
    todayRows,
    todayLoading: todayQuery.isLoading,
    todayError: todayQuery.isError,
    refreshToday: () => void todayQuery.refetch(),
  };
}
