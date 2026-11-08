import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MOBILE_SCREENS } from '../types/permissions';
import { anyOnMenu, filterHomeGridHidden, filterMenuHidden } from './menuHidden';
import { MENU_LAYOUT_REFRESH_MS, useModuleOrder } from './useModuleOrder';

// =============================================================================
// K19 MENÜ DÜZENİ — tablet ana ekran karoları. Fabrikanın gizlediği ekranın karosu kalkar; uç yok / hata (eski
// sunucu) → bugünkü grid; süzgeç her karoyu düşürecekse süzülmez (çıkışsız boş ekran yok).
// =============================================================================
const SCREENS = MOBILE_SCREENS.filter((s) => ['KK1', 'Tambur', 'KursunQc'].includes(s.key));

jest.mock('./useVisibleScreens', () => ({
  useVisibleScreens: () => ({ visibleScreens: mockVisible }),
}));
let mockVisible = SCREENS;
let mockMenu: () => Promise<{ hiddenScreens: string[] }> = () => Promise.resolve({ hiddenScreens: [] });
jest.mock('../services/menuLayout.service', () => ({
  menuLayoutService: { get: () => mockMenu() },
}));
jest.mock('../services/preferences.service', () => ({
  preferencesService: { get: () => Promise.resolve({}), save: jest.fn() },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const keysOf = (r: { current: ReturnType<typeof useModuleOrder> }) => r.current.orderedScreens.map((s) => s.key);

describe('filterMenuHidden (saf)', () => {
  it('liste boş/yok → aynı dizi', () => {
    expect(filterMenuHidden(SCREENS, undefined)).toBe(SCREENS);
    expect(filterMenuHidden(SCREENS, [])).toBe(SCREENS);
  });
  it('gizlenen karo düşer', () => {
    expect(filterMenuHidden(SCREENS, ['KK1']).map((s) => s.key)).toEqual(SCREENS.filter((s) => s.key !== 'KK1').map((s) => s.key));
  });
  it('⭐ hepsi gizliyse süzülmez (çıkışsız kalmasın)', () => {
    expect(filterMenuHidden(SCREENS, SCREENS.map((s) => s.key))).toBe(SCREENS);
  });
});

describe('anyOnMenu (saf) — yan yüzey süzgeç sekmeleri', () => {
  it('karo menüde varsa true, K19 gizlediyse ya da izinli değilse false', () => {
    expect(anyOnMenu(SCREENS, [], ['KK1'])).toBe(true);
    expect(anyOnMenu(SCREENS, ['KK1'], ['KK1'])).toBe(false);
    expect(anyOnMenu(SCREENS, [], ['KartelaSevk'])).toBe(false);
  });
});

describe('useModuleOrder — K19 süzgeci', () => {
  beforeEach(() => {
    mockVisible = SCREENS;
  });
  it('⭐ fabrika KK1 gizledi → karo yok, diğerleri var', async () => {
    mockMenu = () => Promise.resolve({ hiddenScreens: ['KK1'] });
    const { result } = renderHook(() => useModuleOrder(), { wrapper });
    await waitFor(() => expect(keysOf(result)).not.toContain('KK1'));
    expect(keysOf(result)).toEqual(expect.arrayContaining(['Tambur', 'KursunQc']));
  });
  it('eski sunucu (uç 404) → bugünkü grid', async () => {
    mockMenu = () => Promise.reject(new Error('404'));
    const { result } = renderHook(() => useModuleOrder(), { wrapper });
    await waitFor(() => expect(keysOf(result)).toEqual(SCREENS.map((s) => s.key)));
  });
  it('⭐ açık ızgarada panel değişikliği aralıkla gelir (yeniden giriş gerekmez)', async () => {
    jest.useFakeTimers();
    try {
      let gizli: string[] = [];
      mockMenu = () => Promise.resolve({ hiddenScreens: gizli });
      const { result } = renderHook(() => useModuleOrder(), { wrapper });
      await waitFor(() => expect(keysOf(result)).toContain('KK1'));
      gizli = ['KK1'];
      await act(async () => {
        jest.advanceTimersByTime(MENU_LAYOUT_REFRESH_MS + 10);
      });
      await waitFor(() => expect(keysOf(result)).not.toContain('KK1'));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ana sayfa ızgarası — sabit gizli karolar (kullanıcı kararı 2026-11-08)', () => {
  const IE = MOBILE_SCREENS.filter((s) => ['HizliIsEmri', 'GelenBelge', 'IsEmirleri'].includes(s.key));
  const ONLY_HIDDEN = MOBILE_SCREENS.filter((s) => ['HizliIsEmri', 'GelenBelge'].includes(s.key));
  beforeEach(() => {
    mockMenu = () => Promise.resolve({ hiddenScreens: [] });
  });
  it('⭐ izinli olsalar da HizliIsEmri ve GelenBelge ızgarada yok, IsEmirleri var', async () => {
    mockVisible = [...SCREENS, ...IE];
    const { result } = renderHook(() => useModuleOrder(), { wrapper });
    await waitFor(() => expect(keysOf(result)).toContain('IsEmirleri'));
    expect(keysOf(result)).not.toContain('HizliIsEmri');
    expect(keysOf(result)).not.toContain('GelenBelge');
  });
  it('⭐ yalnız bu iki ekrana izni olan rolde ızgara boş kalmaz', async () => {
    expect(ONLY_HIDDEN).toHaveLength(2);
    expect(filterHomeGridHidden(ONLY_HIDDEN)).toBe(ONLY_HIDDEN);
    mockVisible = ONLY_HIDDEN;
    const { result } = renderHook(() => useModuleOrder(), { wrapper });
    await waitFor(() => expect(keysOf(result).length).toBe(2));
  });
  it('anyOnMenu etkilenmez (yan yüzeyler K19 + izne bakar)', () => {
    expect(anyOnMenu(IE, [], ['HizliIsEmri'])).toBe(true);
  });
});
