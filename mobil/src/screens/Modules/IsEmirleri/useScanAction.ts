// İş Emirleri — "Okut" + "İş Emri Türü" durumu: tür grupları (sunucu rotaları), varsayılan, okutma izni/kipi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routeService } from '../../../services/route.service';
import { useScanRouteMode } from '../../../hooks/useFeatureFlags';
import { useVisibleScreens } from '../../../hooks/useVisibleScreens';
import { useTabletWoEntry } from '../GelenBelge/woCreate/useWoEntry';
import { WO_SHORTCUTS_KEY } from '../GelenBelge/woCreate/WoCreateScreen';
import { storage } from '../../../utils/storage';
import { resolveType, typeGroups } from './scanFlow';
import { useAuthStore } from '../../../store/authStore';
import { encodeStoredRoute, storedRouteFor } from './createEntry';

/**
 * Belge Okut tuşundaki rota CİHAZDA kalıcı ama OPERATÖRE bağlı (`<userId>|<routeId>`): operatör değişince kayıt silinir,
 * seçim "Sahada belirlenir"e döner. Ayar ("Rota seçimini Belge Okut tuşunda göster") kapalıyken kayıt OKUNMAZ ve silinir:
 * yeniden açılınca seçim baştan başlar. Silinen/pasif rota → varsayılan.
 */
export const WO_SCAN_ROUTE_KEY = 'device_wo_scan_route';

export function useScanAction(showOnButton: boolean) {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const scanMode = useScanRouteMode();
  const { entry, ready } = useTabletWoEntry();
  // Okutma = gelen belge ekranının yetkisi + modülü (`gelen-belge:write` + gelenBelgeEnabled); TOP kipinde belge yok.
  const docScreen = useVisibleScreens().visibleScreens.some((s) => s.key === 'GelenBelge');
  const available = docScreen && ready && entry !== 'TOP';
  const shortcuts = useQuery({ queryKey: WO_SHORTCUTS_KEY, queryFn: routeService.getShortcuts, retry: false, staleTime: 60_000, enabled: available });
  const routes = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getActive(),
    staleTime: 60_000,
    enabled: available,
  });
  const groups = useMemo(() => typeGroups(routes.data?.data ?? [], shortcuts.data?.data ?? [], scanMode), [routes.data, shortcuts.data, scanMode]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSelectedId(null);
    if (!showOnButton || !userId) {
      void storage.deleteItem(WO_SCAN_ROUTE_KEY).catch(() => undefined);
      return;
    }
    storage
      .getItem(WO_SCAN_ROUTE_KEY)
      .then((raw) => {
        const id = storedRouteFor(raw, userId);
        if (raw && !id) void storage.deleteItem(WO_SCAN_ROUTE_KEY).catch(() => undefined);
        if (alive && id) setSelectedId((cur) => cur ?? id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [showOnButton, userId]);
  const select = useCallback((id: string) => {
    setSelectedId(id);
    if (userId) void storage.setItem(WO_SCAN_ROUTE_KEY, encodeStoredRoute(userId, id)).catch(() => undefined);
  }, [userId]);
  const type = resolveType(selectedId, groups, scanMode);
  return {
    available,
    scanMode,
    loading: shortcuts.isLoading || routes.isLoading,
    groups,
    type,
    select,
  };
}
