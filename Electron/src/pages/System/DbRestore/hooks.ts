import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { pollIntervalFor, type DbCopyListing, type SwapCommands } from "./types";
import {
  DB_COPIES_QUERY_KEY as KEY,
  dropCopy,
  fetchDbCopies,
  fetchSwapCommands,
  startCopy,
  verifyCopy,
} from "./service";

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
  return useQuery<DbCopyListing>({
    queryKey: KEY,
    queryFn: fetchDbCopies,
    refetchInterval: (query) => pollIntervalFor(query.state.data?.job?.phase, isTabActive),
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useStartCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startCopy,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useVerifyCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: verifyCopy,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDropCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dropCopy,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSwapCommands(name: string | null) {
  return useQuery<SwapCommands>({
    queryKey: ["db-copy-swap", name],
    queryFn: () => fetchSwapCommands(name!),
    enabled: !!name,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
