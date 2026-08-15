import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { subcontractorService } from '../services/subcontractor.service';
import type { Subcontractor } from '../types/models';

const EMPTY_FIRMS: Subcontractor[] = [];

/** Kartela fason kategorisinin kodu — seed + canlı DB ile aynı. */
export const KARTELA_CATEGORY_CODE = 'KARTELA';

/**
 * Yalnız "Kartela" kategorisindeki fason firmaları döner. Önce kategori id'si
 * koddan çözülür, sonra firmalar `filter[categoryId]` ile çekilir (mevcut Fason
 * akışıyla aynı mekanizma). Böylece boyahane/zımpara gibi firmalar listelenmez.
 */
export function useKartelaFirms(): {
  firms: Subcontractor[];
  isLoading: boolean;
  /** Kategori hiç tanımlı değil (admin'de "Kartela" kategorisi açılmamış). */
  categoryMissing: boolean;
  /** Cache'i bypass eden taze çekim — picker açılışında çağrılır (admin'de yapılan
   *  kategori/firma değişikliği staleTime beklenmeden yansır). */
  refetch: () => void;
} {
  const catsQuery = useQuery({
    queryKey: ['subcontractor-categories', 'kartela'],
    queryFn: () => subcontractorService.listCategories({ pageSize: 200 }),
    staleTime: 5 * 60_000,
  });
  const kartelaCatId = catsQuery.data?.data.find(
    (c) => c.code === KARTELA_CATEGORY_CODE,
  )?.id;

  const firmsQuery = useQuery({
    queryKey: ['subcontractors', 'kartela', kartelaCatId],
    queryFn: () =>
      subcontractorService.listSubcontractors({
        pageSize: 200,
        filters: { isActive: 'true', categoryId: kartelaCatId! },
      }),
    enabled: !!kartelaCatId,
    staleTime: 5 * 60_000,
  });

  const refetch = useCallback(() => {
    // Önce kategori (yeni "Kartela" kategorisi açılmış olabilir), sonra firmalar
    // (firmaya kategori atanmış/kaldırılmış olabilir).
    void catsQuery.refetch();
    void firmsQuery.refetch();
  }, [catsQuery, firmsQuery]);

  return {
    // ⚠️ Kararlı sabit — `?? []` her render'da yeni dizi üretir; effect
    // bağımlılığına giren tüketici çevrimdışında sonsuz döngüye girer
    // (2026-08-15 useFoldValues saha çökmesi; gerekçe o dosyanın başlığında).
    firms: firmsQuery.data?.data ?? EMPTY_FIRMS,
    isLoading: catsQuery.isLoading || (!!kartelaCatId && firmsQuery.isLoading),
    categoryMissing: catsQuery.isSuccess && !kartelaCatId,
    refetch,
  };
}
