// S16b: tablet iş emri giriş kipi (`gelenBelge.tabletIeGirisi`). Ayar flag yüküne konmaz (S16a), gelen belge ayar
// ucundan okunur; yoksa / okunamazsa IKISI = bugünkü ekran (yeni ayarın varsayılanı bugünkü davranış).
import { useQuery } from '@tanstack/react-query';
import { INBOUND_DOC_SETTINGS_KEY, inboundDocService } from '../../../../services/inboundDoc.service';
import { useAuthStore } from '../../../../store/authStore';
import { resolveWoEntry, type TabletWoEntry } from './woForm';

/** `ready`: kip bilindi (ayar okundu / okunamadı / oturum yok) — o ana kadar seçici karo çizmez (fasonda top yolu sızmasın). */
export function useTabletWoEntry(): { entry: TabletWoEntry; ready: boolean } {
  const hasToken = useAuthStore((s) => !!s.token);
  const settings = useQuery({
    queryKey: INBOUND_DOC_SETTINGS_KEY,
    queryFn: inboundDocService.settings,
    retry: false,
    staleTime: 60_000,
    enabled: hasToken,
  });
  return { entry: resolveWoEntry(settings.data?.tabletIeGirisi), ready: !hasToken || settings.isSuccess || settings.isError };
}
