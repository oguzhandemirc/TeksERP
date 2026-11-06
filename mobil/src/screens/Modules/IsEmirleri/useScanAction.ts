// İş Emirleri — "Okut" + "İş Emri Türü" durumu: tür grupları (sunucu rotaları), varsayılan, okutma izni/kipi.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routeService } from '../../../services/route.service';
import { useScanRouteMode } from '../../../hooks/useFeatureFlags';
import { useVisibleScreens } from '../../../hooks/useVisibleScreens';
import { useTabletWoEntry } from '../GelenBelge/woCreate/useWoEntry';
import { WO_SHORTCUTS_KEY } from '../GelenBelge/woCreate/WoCreateScreen';
import { resolveType, typeGroups } from './scanFlow';

export function useScanAction() {
  const scanMode = useScanRouteMode();
  const { entry, ready } = useTabletWoEntry();
  // Okutma = gelen belge ekranının yetkisi + modülü (`gelen-belge:write` + gelenBelgeEnabled); TOP kipinde belge yok.
  const docScreen = useVisibleScreens().visibleScreens.some((s) => s.key === 'GelenBelge');
  const available = docScreen && ready && entry !== 'TOP';
  const shortcuts = useQuery({ queryKey: WO_SHORTCUTS_KEY, queryFn: routeService.getShortcuts, retry: false, staleTime: 60_000, enabled: available });
  const routes = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 60_000,
    enabled: available,
  });
  const groups = useMemo(() => typeGroups(routes.data?.data ?? [], shortcuts.data?.data ?? [], scanMode), [routes.data, shortcuts.data, scanMode]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const type = resolveType(selectedId, groups, scanMode);
  return {
    available,
    loading: shortcuts.isLoading || routes.isLoading,
    groups,
    type,
    select: setSelectedId,
  };
}
