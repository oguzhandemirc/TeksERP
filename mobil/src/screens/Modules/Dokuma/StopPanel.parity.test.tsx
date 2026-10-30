// =============================================================================
// Dokuma DURUŞ PANELİ — bayt-aynılık tabanı (D4-A2 taşıma öncesi/sonrası)
// =============================================================================
// Render ağacının özeti (JSON → FNV-1a) sabit: panel `components/machine-stop/`a
// taşınınca AYNI sabitler tutmalı (Dokuma ekranı bayt-aynı). Açılış yükü de sabit.
// =============================================================================
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import StopPanel from './StopPanel';
import type { DoffEntry } from './useDoffEntry';

const mockListOpen = jest.fn();
const mockOpen = jest.fn();
jest.mock('../../../services/machineStop.service', () => ({
  machineStopService: {
    listOpen: (...a: unknown[]) => mockListOpen(...a),
    open: (...a: unknown[]) => mockOpen(...a),
    close: jest.fn(),
    classify: jest.fn(),
    revoke: jest.fn(),
  },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../services/reasonPreset.service', () => ({ reasonPresetService: { list: jest.fn().mockResolvedValue([]) } }));
jest.mock('../../../offline/barcode', () => ({ generateClientUuid: () => 'tok-1' }));

const NOW = Date.parse('2026-10-30T08:00:00.000Z');
const OPEN_STOP = {
  id: 's1', machineId: 'm1', runId: null, stopKey: 'k', startedAt: '2026-10-30T06:55:00.000Z', endedAt: null, durationSec: null,
  reasonCode: null, lossClass: null, reasonNote: null, requiresReason: true, source: 'OPERATOR', revokedAt: null,
};

function entry(canRevoke: boolean): DoffEntry {
  return { machine: { id: 'm1' }, isOnline: true, canRevoke } as unknown as DoffEntry;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

describe('Dokuma StopPanel bayt-aynılık', () => {
  it('çalışırken: "Tezgah çalışıyor" + Duruş Bildir; ağaç özeti sabit', async () => {
    mockListOpen.mockResolvedValue([]);
    const r = renderWithPaper(<StopPanel entry={entry(true)} />);
    await waitFor(() => expect(mockListOpen).toHaveBeenCalled());
    await act(async () => {});
    expect(r.getByText('Duruş Bildir')).toBeTruthy();
    expect(r.getByText('Tezgah çalışıyor')).toBeTruthy();
    expect(fnv(JSON.stringify(r.toJSON()))).toBe(RUNNING_HASH);
  });

  it('duruşta: süre + sebep borcu + Çalıştı + Geri al; ağaç özeti sabit', async () => {
    mockListOpen.mockResolvedValue([OPEN_STOP]);
    const r = renderWithPaper(<StopPanel entry={entry(true)} />);
    await waitFor(() => expect(r.getByText('DURUŞTA · 1 sa 05 dk')).toBeTruthy());
    expect(r.getByText('Sebep bekliyor')).toBeTruthy();
    expect(r.getByText('Çalıştı')).toBeTruthy();
    expect(r.getByText('Geri al')).toBeTruthy();
    expect(fnv(JSON.stringify(r.toJSON()))).toBe(STOPPED_HASH);
  });

  it('Duruş Bildir → Duruşu Aç: yük ve token aynı', async () => {
    mockListOpen.mockResolvedValue([]);
    mockOpen.mockResolvedValue({ success: true, data: OPEN_STOP });
    const r = renderWithPaper(<StopPanel entry={entry(false)} />);
    await waitFor(() => expect(mockListOpen).toHaveBeenCalled());
    // Gizli modalın ilk kapanış animasyonu (zamanlayıcıyla biter) açılışı ezmesin.
    await act(async () => {
      await new Promise((res) => setTimeout(res, 500));
    });
    fireEvent.press(r.getByRole('button', { name: /Duruş Bildir/ }));
    await act(async () => {});
    await act(async () => {});
    await waitFor(() => expect(r.getByText('Duruşu Aç')).toBeTruthy());
    await act(async () => {
      fireEvent.press(r.getByRole('button', { name: /Duruşu Aç/ }));
    });
    await act(async () => {});
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(1));
    expect(mockOpen.mock.calls[0][0]).toEqual({ machineId: 'm1', startedAt: expect.any(String), reasonCode: null, reasonNote: null, clientToken: 'tok-1' });
  });
});

const RUNNING_HASH = '5d5657ff';
const STOPPED_HASH = '474dfe57';
