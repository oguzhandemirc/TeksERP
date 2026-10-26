import { useState } from "react";
import { useScanSeed } from "@/hooks/useScanSeed";
import { ACTIVITY_QUERY_SEED } from "@/components/audit/TraceLink";
import type { ActivityFilterState } from "./activity-view";

/**
 * Kayıt kartından "İz sür": numara İşlemler görünümünün aramasına tohumlanır.
 * Dönen sürüm süzgeç çubuğunun `key`idir — kutu yeniden kurulur, numarayı gösterir.
 */
export function useActivityTraceSeed(setFilters: (f: ActivityFilterState) => void): number {
  const [rev, setRev] = useState(0);
  useScanSeed(ACTIVITY_QUERY_SEED, (q) => {
    setFilters({ gorunum: "islem", q });
    setRev((n) => n + 1);
  });
  return rev;
}
