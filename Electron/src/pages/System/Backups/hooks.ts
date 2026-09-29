import type { MutableRefObject } from "react";
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
export function useRestoreImpact(
  name: string | null,
  /** Şifreli yedeğin parolası: sorgu OKUR ve hemen SİLER (hatırlanmaz); `attempt` yeniden sorar. */
  password?: { ref: MutableRefObject<string | null>; attempt: number },
) {
  return useQuery<RestoreImpact>({
    // Parola anahtara GİRMEZ (önbellek/devtools) — yalnız deneme sayacı.
    queryKey: ["backup-restore-impact", name, password?.attempt ?? 0],
    queryFn: () => {
      const pw = password?.ref.current ?? null;
      if (password) password.ref.current = null;
      return fetchRestoreImpact(name!, pw);
    },
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
