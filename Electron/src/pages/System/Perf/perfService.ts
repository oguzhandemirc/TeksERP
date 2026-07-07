import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import apiClient from "@/services/apiClient";

// Backend kontratları — Teks-Erp GET /api/admin/perf ve /perf/history şekilleri.

export interface PerfRoute {
  route: string;
  count: number;
  errCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastAt: number;
}

export interface SlowRequest {
  at: number;
  method: string;
  route: string;
  status: number;
  ms: number;
}

export interface PerfPersistHealth {
  flushFailures: number;
  lastFlushError: string | null;
  lastFlushOkAt: number | null;
  pendingRoutes: number;
}

export interface PerfSnapshot {
  sinceAt: number;
  totalCount: number;
  routes: PerfRoute[];
  slowRequests: SlowRequest[];
  persist: PerfPersistHealth;
}

export interface PerfHistoryPoint {
  day: string; // "YYYY-MM-DD"
  count: number;
  errCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface PerfHistory {
  days: number;
  route: string | null;
  series: PerfHistoryPoint[];
  routes: string[];
}

const SNAPSHOT_REFRESH_MS = 15_000;

/** Canlı snapshot — sekme aktifken 15sn'de bir tazelenir (ServerStatus deseni). */
export function usePerfSnapshot() {
  const isTabActive = useIsTabActive();
  return useQuery({
    queryKey: ["perf", "snapshot"],
    queryFn: async (): Promise<PerfSnapshot> =>
      (await apiClient.get<{ success: boolean; data: PerfSnapshot }>("/api/admin/perf")).data.data,
    refetchInterval: isTabActive ? SNAPSHOT_REFRESH_MS : false,
  });
}

/** Günlük geçmiş — route null = tüm uçların birleşik toplamı. */
export function usePerfHistory(days: number, route: string | null) {
  return useQuery({
    queryKey: ["perf", "history", days, route],
    queryFn: async (): Promise<PerfHistory> =>
      (
        await apiClient.get<{ success: boolean; data: PerfHistory }>("/api/admin/perf/history", {
          params: { days, ...(route ? { route } : {}) },
        })
      ).data.data,
  });
}

/** Sayaç sıfırlama + ilgili query'lerin tazelenmesi. */
export function usePerfReset() {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    await apiClient.post("/api/admin/perf/reset", {});
    await qc.invalidateQueries({ queryKey: ["perf"] });
  };
}
