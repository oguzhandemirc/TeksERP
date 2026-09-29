import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { licenseService } from "@/services/licenseService";
import { LICENSE_DETAIL_KEY, LICENSE_STATUS_KEY } from "@/hooks/useLicenseStatus";
import { apiErrorText } from "@/lib/api-error";

export function useLicenseDetail(enabled: boolean) {
  return useQuery({
    queryKey: LICENSE_DETAIL_KEY,
    queryFn: licenseService.detail,
    enabled,
    // Yoklama/zil durumu backend belleğinde değişir; ekran açıkken dakikada bir yeter.
    refetchInterval: 60_000,
    retry: false,
  });
}

/**
 * Lisans eylemi koşucusu: sonuç cümlesi toast'a, hata backend'in kendi cümlesiyle
 * TEK toast'a (servis çağrıları interceptor toast'ını bastırır); başarıda durum
 * ve ayrıntı sorguları tazelenir.
 */
export function useLicenseAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<string | null>): Promise<boolean> => {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) toast.success(msg);
      await Promise.all([
        qc.invalidateQueries({ queryKey: LICENSE_DETAIL_KEY }),
        qc.invalidateQueries({ queryKey: LICENSE_STATUS_KEY }),
      ]);
      return true;
    } catch (err) {
      toast.error(apiErrorText(err, "Lisans işlemi tamamlanamadı."));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
