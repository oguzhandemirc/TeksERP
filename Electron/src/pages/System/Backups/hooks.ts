import { useQuery } from "@tanstack/react-query";
import type { RestoreImpact } from "./restore-impact.types";
import {
  OFFSITE_QUERY_KEY,
  fetchBackups,
  fetchOffsiteStatus,
  fetchRestoreImpact,
  type BackupListing,
  type OffsiteStatus,
} from "./service";

export function useBackups() {
  return useQuery<BackupListing>({
    queryKey: ["admin-backups"],
    queryFn: fetchBackups,
  });
}

/**
 * Geri yükleme etki önizlemesi. `staleTime: 0` + `gcTime: 0`: bu veri yıkıcı bir
 * karara temel oluşturuyor, bayat gösterilmesi kabul edilemez (kayıp sayıları
 * saniyeler içinde değişir). Dialog kapalıyken sorgu koşmaz.
 */
export function useRestoreImpact(name: string | null) {
  return useQuery<RestoreImpact>({
    queryKey: ["backup-restore-impact", name],
    queryFn: () => fetchRestoreImpact(name!),
    enabled: !!name,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function useOffsiteStatus() {
  return useQuery<OffsiteStatus>({
    queryKey: OFFSITE_QUERY_KEY,
    queryFn: fetchOffsiteStatus,
    // Süpürme saatte bir koşuyor; bu ekran açıkken dakikada bir tazelemek yeter.
    refetchInterval: 60_000,
  });
}
