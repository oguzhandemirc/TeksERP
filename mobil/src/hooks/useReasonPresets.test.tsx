import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useReasonPresets, isBuiltinPreset } from './useReasonPresets';
import { reasonPresetService } from '../services/reasonPreset.service';

// =============================================================================
// Test: hazır sebep kataloğunun ÜÇ KADEMESİ (2026-08-19)
// =============================================================================
// Katalog sunucuya taşındı; Tambur ise çevrimdışı çalışıyor ve fire kararında
// sebep ZORUNLU. Bu testin koruduğu iki sözleşme:
//
//   1. LİSTE ASLA BOŞ DÖNMEZ — sunucu erişilemezken gömülü zemin kullanılır.
//      Boş liste = operatör "Kaydet"e hiç basamaz = mal tamburda kilitlenir.
//   2. REFERANS KARARLIDIR — aynı veri için aynı dizi nesnesi döner. `?? []`
//      yazımı 2026-08-15 saha çökmesinin kök nedeniydi (her render'da yeni dizi
//      → effect döngüsü → "Maximum update depth exceeded").
// =============================================================================

jest.mock('../services/reasonPreset.service', () => {
  const actual = jest.requireActual('../services/reasonPreset.service');
  return { ...actual, reasonPresetService: { list: jest.fn() } };
});

const mockList = reasonPresetService.list as jest.Mock;

function Probe({ onRender }: { onRender: (v: ReturnType<typeof useReasonPresets>) => void }) {
  const v = useReasonPresets('ROLL_SCRAP');
  onRender(v);
  return <Text>{v.presets.map((p) => p.code).join(',')}</Text>;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('useReasonPresets', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sunucu erişilemezken GÖMÜLÜ ZEMİNE düşer (liste boş kalmaz)', async () => {
    mockList.mockRejectedValue(new Error('Network Error'));
    const seen: ReturnType<typeof useReasonPresets>[] = [];
    const { getByText } = wrap(<Probe onRender={(v) => seen.push(v)} />);

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const last = seen[seen.length - 1]!;
    expect(last.presets.length).toBeGreaterThan(0);
    expect(last.isFallback).toBe(true);
    // Zemin, Tambur'un bugün gösterdiği listeyi taşımalı — "Top başı" başta.
    expect(last.presets[0]!.code).toBe('TOP_BASI');
    expect(isBuiltinPreset(last.presets[0]!)).toBe(true);
    getByText(/TOP_BASI/);
  });

  it('zemin referansı KARARLIDIR — render başına yeni dizi üretmez', async () => {
    mockList.mockRejectedValue(new Error('Network Error'));
    const seen: ReturnType<typeof useReasonPresets>[] = [];
    wrap(<Probe onRender={(v) => seen.push(v)} />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(1));
    // Tüm render'larda AYNI nesne (identity) — bkz. dosya başlığı, madde 2.
    const unique = new Set(seen.map((s) => s.presets));
    expect(unique.size).toBe(1);
  });

  it('sunucu listesi gelince onu kullanır ve SIRAYA saygı gösterir', async () => {
    mockList.mockResolvedValue([
      { id: 'b', kind: 'ROLL_SCRAP', code: 'B', label: 'İkinci', fullText: null, requiresText: false, sortOrder: 1, isActive: true, isSystem: false },
      { id: 'a', kind: 'ROLL_SCRAP', code: 'A', label: 'Birinci', fullText: null, requiresText: false, sortOrder: 0, isActive: true, isSystem: true },
      { id: 'x', kind: 'ROLL_CANCEL', code: 'X', label: 'Başka liste', fullText: null, requiresText: false, sortOrder: 0, isActive: true, isSystem: true },
      { id: 'h', kind: 'ROLL_SCRAP', code: 'H', label: 'Gizli', fullText: null, requiresText: false, sortOrder: 2, isActive: false, isSystem: false },
    ]);
    const seen: ReturnType<typeof useReasonPresets>[] = [];
    wrap(<Probe onRender={(v) => seen.push(v)} />);

    await waitFor(() => {
      const last = seen[seen.length - 1]!;
      expect(last.isFallback).toBe(false);
    });
    const last = seen[seen.length - 1]!;
    // Sıra sunucununki, başka türün satırı sızmaz, GİZLİ satır operatöre ÇİZİLMEZ.
    expect(last.presets.map((p) => p.code)).toEqual(['A', 'B']);
  });
});
