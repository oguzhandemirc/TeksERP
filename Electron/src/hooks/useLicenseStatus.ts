import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { licenseService } from "@/services/licenseService";
import { useAuthStore } from "@/store/auth";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";
import { isLicenseScreenVisible } from "@/lib/license/visibility";
import { onLicenseGate } from "@/lib/license/signal";
import type { LicenseStatusSummary } from "@/types/license";

export const LICENSE_STATUS_KEY = ["license", "durum"] as const;
export const LICENSE_DETAIL_KEY = ["license", "detay"] as const;

/** Kademe değişimi saniyeler içinde değil, dakikalar içinde yeter; zil backend'de. */
const STATUS_REFRESH_MS = 5 * 60_000;

/**
 * Oturumlu kullanıcının lisans durum özeti (`GET /api/license/durum`).
 * Oturum yoksa sorgu koşmaz; hata/kimliksiz yanıt `null` döner — bant ve kilit
 * yalnız ölçülmüş bir karar üzerine çizilir, belirsizlik bugünkü davranıştır.
 */
export function useLicenseStatus(): LicenseStatusSummary | null {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...LICENSE_STATUS_KEY, userId],
    queryFn: licenseService.status,
    enabled: userId !== null,
    staleTime: 60_000,
    refetchInterval: STATUS_REFRESH_MS,
    retry: false,
  });
  useEffect(
    () => onLicenseGate(() => void qc.invalidateQueries({ queryKey: LICENSE_STATUS_KEY })),
    [qc],
  );
  const d = q.data;
  return d && d.ayrinti ? d : null;
}

/** Lisans ekranı (karo · palet · sayfa) bu oturuma çizilir mi. */
export function useLicenseScreenVisible(): boolean {
  const status = useLicenseStatus();
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  return isLicenseScreenVisible({
    kip: status?.kip ?? null,
    superadminGateOpen: isSuperadminGateOpen({ isSystemAccount, systemAccountExists }),
  });
}
