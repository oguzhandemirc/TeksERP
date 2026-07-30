import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import {
  pollIntervalFor,
  type DbCopyListing,
  type SwapCommands,
  type VerificationReport,
} from "./types";

const KEY = ["db-copies"];

/**
 * Kopya listesi + canlı iş durumu.
 *
 * **Dinamik `refetchInterval`** (repoda ilk): iş koşarken 2sn, bitince durur.
 * İki tuzak:
 *  1. TanStack v5'te fonksiyon-formuna gelen argüman **Query nesnesidir**, `data`
 *     DEĞİL — `query.state.data` yazılmazsa `undefined` döner ve SESSİZCE hiç
 *     poll etmez.
 *  2. `useIsTabActive()` gating'i ZORUNLU (K-A8) — pasif sekmeler mount kalıyor.
 */
export function useDbCopies() {
  const isTabActive = useIsTabActive();
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<DbCopyListing> => {
      const res = await apiClient.get<{ success: boolean; data: DbCopyListing }>(
        "/api/admin/db-copies",
        { suppressErrorToast: true },
      );
      return res.data.data;
    },
    refetchInterval: (query) => pollIntervalFor(query.state.data?.job?.phase, isTabActive),
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useStartCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (backupName: string) => {
      const res = await apiClient.post<{ success: boolean; message: string; copyName?: string }>(
        "/api/admin/db-copies",
        { backupName },
        { suppressErrorToast: true },
      );
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useVerifyCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await apiClient.post<{ success: boolean; data: VerificationReport }>(
        `/api/admin/db-copies/${encodeURIComponent(name)}/verify`,
        {},
        { suppressErrorToast: true },
      );
      return res.data.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDropCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; force?: boolean }) => {
      const res = await apiClient.delete<{ success: boolean; message: string }>(
        `/api/admin/db-copies/${encodeURIComponent(input.name)}${input.force ? "?force=1" : ""}`,
        { suppressErrorToast: true },
      );
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * Takas + geri alma komut blokları. Kopya `ready` değilse backend 409 döner ve
 * komut ÜRETİLMEZ — yarım bir kopyaya geçiş felakettir.
 */
export function useSwapCommands(name: string | null) {
  return useQuery({
    queryKey: ["db-copy-swap", name],
    queryFn: async (): Promise<SwapCommands> => {
      const res = await apiClient.get<{ success: boolean; data: SwapCommands }>(
        `/api/admin/db-copies/${encodeURIComponent(name!)}/swap-command`,
        { suppressErrorToast: true },
      );
      return res.data.data;
    },
    enabled: !!name,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export const DB_COPIES_QUERY_KEY = KEY;
