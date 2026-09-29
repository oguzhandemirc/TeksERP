import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { licenseService } from '../services/license.service';
import { useAuthStore } from '../store/authStore';
import { useLicenseStore } from '../store/licenseStore';
import { isSuspendedStatus } from '../lib/license';

// Lisans durumu app genelinde tek sorgu. PERSIST EDİLMEZ (persistPolicy allowlist'inde
// yok): dünkü K5 bugün açılışta tableti kilitlemesin, kaynak her zaman sunucu.
// Eski backend (uç yok → 404) ya da ağ hatası = veri yok = hiçbir şey çizilmez.
export const LICENSE_STATUS_KEY = ['license', 'durum'] as const;

const REFRESH_MS = 5 * 60 * 1000;

export function useLicenseStatus() {
  // Kimliksiz çağrı ayrıntı döndürmez (backend bilinçli) — token yokken sorma.
  const hasToken = useAuthStore((s) => !!s.token);
  const blockSeq = useLicenseStore((s) => s.blockSeq);
  const query = useQuery({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: licenseService.getStatus,
    enabled: hasToken,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    retry: false,
  });

  // Kapı reddi geldiyse bandı/kademeyi 5 dk beklemeden tazele.
  const { refetch } = query;
  useEffect(() => {
    if (blockSeq > 0 && hasToken) void refetch();
  }, [blockSeq, hasToken, refetch]);

  // Sunucu artık durdurulmuş demiyorsa (geri alındı) önceki K5 sinyali düşer.
  // `dataUpdatedAt`: yapısal paylaşım aynı yanıtta aynı nesneyi döndürür; tazeleme yine sayılır.
  const { data, dataUpdatedAt } = query;
  useEffect(() => {
    if (data && !isSuspendedStatus(data)) useLicenseStore.getState().clearSuspended();
  }, [data, dataUpdatedAt]);

  return query;
}
