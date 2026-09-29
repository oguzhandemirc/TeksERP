import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authService } from "@/services/authService";
import { DEFAULT_COMPANY_NAME } from "@/services/featureFlagService";
import { getActiveApiBaseUrl } from "@/lib/api-config";
import { useLicenseSuspension } from "@/lib/license/suspension";

/**
 * Bağlanılan sunucunun public login-methods yanıtı — girişten ÖNCE okunur.
 * Anahtar aktif adresi taşır: sunucu değişince yeniden okunur.
 */
function useLoginMethods() {
  const baseUrl = getActiveApiBaseUrl();
  return useQuery({
    queryKey: ["auth", "login-methods", baseUrl],
    queryFn: authService.getLoginMethods,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Firma adı — ad koda gömülmez: sunucu okunamazsa ya da ad boşsa nötr yedek gösterilir.
 */
export function useServerCompanyName(): string {
  const q = useLoginMethods();
  return q.data?.data?.companyName?.trim() || DEFAULT_COMPANY_NAME;
}

/**
 * K5 giriş sinyali (`lisansDurduruldu`) — kimliksize verilen TEK lisans bilgisi, yalnız
 * zorlamada ve durdurulmuşken true (eski backend alanı göndermez → false). Değer oturum
 * kabuğu kararına da yazılır: giriş yapan yönetici doğrudan "verilerimi al" sayfasına gider.
 */
export function useLoginLicenseSuspended(): boolean {
  const q = useLoginMethods();
  const known = q.data?.data !== undefined;
  const suspended = q.data?.data?.lisansDurduruldu === true;
  useEffect(() => {
    if (known) useLicenseSuspension.getState().setSuspended(suspended);
  }, [known, suspended]);
  return suspended;
}
