import { useQuery } from "@tanstack/react-query";
import { authService } from "@/services/authService";
import { DEFAULT_COMPANY_NAME } from "@/services/featureFlagService";
import { getActiveApiBaseUrl } from "@/lib/api-config";

/**
 * Bağlanılan sunucunun firma adı — girişten ÖNCE, public login-methods ucundan.
 * Ad koda gömülmez: sunucu okunamazsa ya da ad boşsa nötr yedek gösterilir.
 * Anahtar aktif adresi taşır: sunucu değişince ad da yeniden okunur.
 */
export function useServerCompanyName(): string {
  const baseUrl = getActiveApiBaseUrl();
  const q = useQuery({
    queryKey: ["auth", "login-methods", baseUrl],
    queryFn: authService.getLoginMethods,
    staleTime: 60_000,
    retry: false,
  });
  return q.data?.data?.companyName?.trim() || DEFAULT_COMPANY_NAME;
}
