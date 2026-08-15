// =============================================================================
// Bekçi: useFoldValues — "veri yokken dönen liste kimliği KARARLIDIR"
// =============================================================================
// 2026-08-15 saha çökmesinin (SM-X230, 2.7.0–2.7.2, `Maximum update depth
// exceeded`) kök nedeni bu hook'taki `q.data ?? []` idi: sunucu erişilemez +
// cache yokken `q.data` süresiz `undefined` kalır ve `?? []` HER render'da YENİ
// dizi üretir. TamburScreen'in kat-varsayılanı effect'i bu diziyi bağımlılık
// listesinde taşıdığı için her render'da yeniden koşup `setWork({...})` çağırdı
// → sonsuz döngü → uygulama Tambur açılır açılmaz düştü (etkileşim bile
// gerekmeden). Düzeltme: boşluk değeri MODÜL SABİTİ (`EMPTY_FOLD_VALUES`).
//
// Bu test o sözleşmeyi kilitler: sorgu hiç veri dönmezken art arda render'larda
// `values` REFERANSI değişmemeli. Sabit yerine `?? []` geri gelirse test kırmızı.
// =============================================================================

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';

import { useFoldValues } from './useFoldValues';

jest.mock('../services/fabricProperty.service', () => ({
  fabricPropertyService: {
    // Hiç çözülmeyen istek = "sunucu erişilemez, cache yok" durumu.
    getFoldValues: jest.fn(() => new Promise(() => {})),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useFoldValues — çevrimdışı kimlik kararlılığı', () => {
  it('veri yokken values referansı render’lar arasında AYNI kalır', () => {
    const { result, rerender } = renderHook(() => useFoldValues(), { wrapper });

    const ilk = result.current.values;
    expect(ilk).toEqual([]);

    rerender(undefined);
    rerender(undefined);

    // ⚠️ Saha çökmesinin kilidi: yeni dizi dönseydi effect bağımlılıkları her
    // render'da "değişir" ve tüketici sonsuz döngüye girerdi.
    expect(result.current.values).toBe(ilk);
  });
});
