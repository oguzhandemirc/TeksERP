// K30-D kişisel alan tercihi: oku-birleştir-yaz (panelin anahtarları ezilmez), ağ hatasında yerelde tutup sonra yazar,
// tercih okunamazsa hepsi açık.
import React, { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PREF_RETRY_MS, useWoFieldPrefs } from './useWoFieldPrefs';

let mockBlob: Record<string, unknown> = {};
const mockGet = jest.fn(async () => mockBlob);
const mockSave = jest.fn(async (b: Record<string, unknown>) => {
  mockBlob = b;
  return b;
});
jest.mock('../../../../services/preferences.service', () => ({
  preferencesService: { get: () => mockGet(), save: (b: Record<string, unknown>) => mockSave(b) },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockBlob = {};
});

describe('useWoFieldPrefs', () => {
  it('kayıtlı gizli liste okunur; değişiklik TAZE blob üstüne yazılır (panelin bu arada yazdığı anahtar korunur)', async () => {
    mockBlob = { theme: 'dark', tabletIeForm: { gizli: ['not'] } };
    const { result } = renderHook(() => useWoFieldPrefs(), { wrapper });
    await waitFor(() => expect(result.current.hidden).toEqual(['not']));
    mockBlob = { ...mockBlob, accent: 'mavi' };
    act(() => result.current.toggle('en'));
    expect(result.current.hidden).toEqual(['not', 'en']);
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0]).toEqual({ theme: 'dark', accent: 'mavi', tabletIeForm: { gizli: ['not', 'en'] } });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('zorunlu alan kapatılamaz; Varsayılana dön boş liste yazar', async () => {
    mockBlob = { tabletIeForm: { gizli: ['en'] } };
    const { result } = renderHook(() => useWoFieldPrefs(), { wrapper });
    await waitFor(() => expect(result.current.hidden).toEqual(['en']));
    act(() => result.current.toggle('musteri'));
    expect(result.current.hidden).toEqual(['en']);
    act(() => result.current.reset());
    expect(result.current.hidden).toEqual([]);
    await waitFor(() => expect(mockBlob).toEqual({ tabletIeForm: { gizli: [] } }));
  });

  it('tercih okunamazsa hepsi açık', async () => {
    mockGet.mockRejectedValueOnce(new Error('ağ yok'));
    const { result } = renderHook(() => useWoFieldPrefs(), { wrapper });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(result.current.hidden).toEqual([]);
  });

  it('ağ hatasında seçim yerelde kalır (pending) ve aralıkla yeniden yazılır', async () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useWoFieldPrefs(), { wrapper });
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
      mockSave.mockRejectedValueOnce(new Error('ağ yok'));
      act(() => result.current.toggle('not'));
      await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.pending).toBe(true));
      expect(result.current.hidden).toEqual(['not']);
      await act(async () => {
        jest.advanceTimersByTime(PREF_RETRY_MS);
      });
      await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
      expect(mockBlob).toEqual({ tabletIeForm: { gizli: ['not'] } });
      await waitFor(() => expect(result.current.pending).toBe(false));
    } finally {
      jest.useRealTimers();
    }
  });
});
