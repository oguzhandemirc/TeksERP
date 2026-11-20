// "Taleplerim" listesi — ekran açıkken 30 sn'de bir yenilenir (gözlemci yalnız
// ekran ayaktayken yaşar). "Firmanın" sekmesi sunucunun `/durum.firmaYoneticisi`
// kararıyla çıkar (tek kaynak); yine de 403 gelirse KALICI gizlenir (bu ekran ömrü boyunca).
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { destekService, type DestekScope } from '../../services/destek.service';
import { LIST_REFRESH_MS, nextPage, yetkisizMi } from './destekGorunurluk';
import { destekKeys, useDestekFirmaYoneticisi } from './useDestek';

export function useTaleplerim() {
  const aday = useDestekFirmaYoneticisi();
  const [kapsam, setKapsam] = useState<DestekScope>('mine');
  const [firmaYasak, setFirmaYasak] = useState(false);

  const q = useInfiniteQuery({
    queryKey: destekKeys.liste(kapsam),
    queryFn: ({ pageParam }) => destekService.liste({ scope: kapsam, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    refetchInterval: LIST_REFRESH_MS,
    retry: false,
  });

  useEffect(() => {
    if (kapsam === 'tenant' && q.error && yetkisizMi(q.error)) {
      setFirmaYasak(true);
      setKapsam('mine');
    }
  }, [kapsam, q.error]);

  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return {
    kapsam,
    setKapsam,
    firmaSekmesi: aday && !firmaYasak,
    rows,
    yukleniyor: q.isPending,
    hata: q.error,
    yenile: () => void q.refetch(),
    yenileniyor: q.isRefetching,
    dahaFazla: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
    },
  };
}
