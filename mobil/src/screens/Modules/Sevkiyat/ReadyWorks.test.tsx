// =============================================================================
// Bekçi: Sevk Kapısı sevke hazır iş çipleri (D4-J4)
// =============================================================================
// Kilitlenen sözleşme:
//   • çipler AYRI tek istekten (`/shipping/ready-works?groupBy=customer`); board isteği değişmez,
//   • eski backend 404 → servis null → şerit çizilmez (hata/tost yok); başka hata yukarı fırlar,
//   • çip sayısı ready-works yanıtının (READY/PARTIAL) satır sayısına eşit,
//   • çipe dokununca müşterinin hazır işleri; "Paketlemeye geç" mevcut akışa (ikinci sevk yaratıcı yok).
// =============================================================================

import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ apiClient: { get: (...a: unknown[]) => mockGet(...a) } }));
// eslint-disable-next-line import/first
import { renderWithPaper } from '../../../test/render';
// eslint-disable-next-line import/first
import { readyWorksService, type ReadyWorkRow } from '../../../services/readyWorks.service';
// eslint-disable-next-line import/first
import { ReadyWorksSheet, ReadyWorksStrip, readyChipRows, readyChipText } from './ReadyWorks';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

function row(id: string, over: Partial<ReadyWorkRow> = {}): ReadyWorkRow {
  return {
    unit: 'customer',
    id,
    label: `Müşteri ${id.slice(0, 4)}`,
    customerId: id,
    customerName: `Müşteri ${id.slice(0, 4)}`,
    state: 'READY',
    readyCount: 3,
    readyMeters: 1250,
    inProcessCount: 0,
    inProcessMeters: 0,
    shippedMeters: 0,
    targetMeters: null,
    ...over,
  };
}
const ok = (items: ReadyWorkRow[]) => ({ data: { success: true, data: { items, nextCursor: null } } });
const httpErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(() => mockGet.mockReset());

describe('readyWorksService — ayrı tek istek, 404 kolu', () => {
  it('müşteri ekseni tek GET: groupBy=customer + READY,PARTIAL', async () => {
    mockGet.mockResolvedValueOnce(ok([row(C1)]));
    await expect(readyWorksService.listCustomers()).resolves.toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(1);
    const url = String(mockGet.mock.calls[0][0]);
    expect(url.startsWith('/shipping/ready-works?')).toBe(true);
    expect(url).toContain('groupBy=customer');
    expect(url).toContain('state=READY%2CPARTIAL');
  });
  it('eski backend 404 → null (özellik yok, hata yok)', async () => {
    mockGet.mockRejectedValueOnce(httpErr(404));
    await expect(readyWorksService.listCustomers()).resolves.toBeNull();
  });
  it('404 dışı hata yukarı fırlar (sessizce yutulmaz)', async () => {
    mockGet.mockRejectedValueOnce(httpErr(500));
    await expect(readyWorksService.listCustomers()).rejects.toThrow('HTTP 500');
  });
  it('müşterinin işleri customerId + eksenle', async () => {
    mockGet.mockResolvedValueOnce(ok([]));
    await readyWorksService.listCustomerWorks(C1, 'deliveryNote');
    const url = String(mockGet.mock.calls[0][0]);
    expect(url).toContain('groupBy=deliveryNote');
    expect(url).toContain(`customerId=${C1}`);
  });
});

describe('readyChipRows / readyChipText', () => {
  it('NONE ve hazır topu olmayan satır çip üretmez; null → boş', () => {
    expect(readyChipRows(null)).toEqual([]);
    expect(readyChipRows([row(C1), row(C2, { state: 'NONE' }), row('x', { readyCount: 0, state: 'PARTIAL' })]).map((r) => r.id)).toEqual([C1]);
  });
  it('metin durum + top + metre', () => {
    expect(readyChipText(row(C1))).toBe('Hazır: 3 top · 1.250 m');
    expect(readyChipText(row(C1, { state: 'PARTIAL' }))).toBe('Kısmen hazır: 3 top · 1.250 m');
  });
});

describe('ReadyWorksStrip', () => {
  it('çip sayısı ready-works yanıtıyla eşit', async () => {
    mockGet.mockResolvedValueOnce(ok([row(C1), row(C2, { state: 'PARTIAL' })]));
    renderWithPaper(<ReadyWorksStrip onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('hazir-is-serit')).toBeTruthy());
    expect(screen.getAllByTestId(/^hazir-is-cip-/)).toHaveLength(2);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
  it('eski backend 404 → şerit/çip yok', async () => {
    mockGet.mockRejectedValueOnce(httpErr(404));
    renderWithPaper(<ReadyWorksStrip onOpen={() => {}} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('hazir-is-serit')).toBeNull());
    expect(screen.queryAllByTestId(/^hazir-is-cip-/)).toHaveLength(0);
  });
  it('çipe dokununca o müşterinin satırı verilir', async () => {
    const onOpen = jest.fn();
    mockGet.mockResolvedValueOnce(ok([row(C1)]));
    renderWithPaper(<ReadyWorksStrip onOpen={onOpen} />);
    fireEvent.press(await screen.findByTestId(`hazir-is-cip-${C1}`));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: C1 }));
  });
});

describe('ReadyWorksSheet', () => {
  it('müşterinin hazır işlerini listeler; Paketlemeye geç müşteri kimliğiyle', async () => {
    mockGet.mockResolvedValueOnce(ok([row('w1', { unit: 'workOrder', label: 'İE-0001', customerId: C1 })]));
    const onGoPacking = jest.fn();
    renderWithPaper(<ReadyWorksSheet customer={row(C1)} incomingDocsEnabled={false} onDismiss={() => {}} onGoPacking={onGoPacking} />);
    expect(await screen.findByTestId('hazir-is-satir-w1')).toBeTruthy();
    expect(String(mockGet.mock.calls[0][0])).toContain('groupBy=workOrder');
    fireEvent.press(screen.getByTestId('hazir-is-paketleme'));
    expect(onGoPacking).toHaveBeenCalledWith(C1);
  });
});

describe('SevkiyatScreen bağlantısı', () => {
  const src = readFileSync(path.join(__dirname, 'SevkiyatScreen.tsx'), 'utf8');
  it('şerit + liste bağlı; sevk yalnız mevcut Paketleme akışına', () => {
    expect(src).toContain('<ReadyWorksStrip');
    expect(src).toContain('<ReadyWorksSheet');
    expect(src).toMatch(/nav\.navigate\('Paketleme', \{ customerId \}\)/);
  });
  it('board isteği hazır iş alanı taşımaz (ayrı uç)', () => {
    const svc = readFileSync(path.join(__dirname, '../../../services/packing.service.ts'), 'utf8');
    expect(svc).not.toMatch(/ready-works/);
  });
});
