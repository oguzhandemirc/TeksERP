// =============================================================================
// Bekçi: Sevk Çıkışı sevke hazır iş yardımcıları (D4-J4; şerit 2026-11-11'de kalktı)
// =============================================================================
// Kilitlenen sözleşme:
//   • hazırlık AYRI tek istekten (`/shipping/ready-works?groupBy=customer`); board isteği değişmez,
//   • eski backend 404 → servis null (hata/tost yok); başka hata yukarı fırlar,
//   • satır metni hazır top + metre (+ işlemdeki top); şerit ve "Paketlemeye geç" sheet'i Sevk Çıkışı'nda YOK.
// =============================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ apiClient: { get: (...a: unknown[]) => mockGet(...a) } }));
// eslint-disable-next-line import/first
import { readyWorksService, type ReadyWorkRow } from '../../../services/readyWorks.service';
// eslint-disable-next-line import/first
import { readyChipRows, readyChipText } from './ReadyWorks';

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
});

describe('readyChipRows / readyChipText', () => {
  it('NONE ve hazır topu olmayan satır çip üretmez; null → boş', () => {
    expect(readyChipRows(null)).toEqual([]);
    expect(readyChipRows([row(C1), row(C2, { state: 'NONE' }), row('x', { readyCount: 0, state: 'PARTIAL' })]).map((r) => r.id)).toEqual([C1]);
  });
  it('metin durum + top + metre', () => {
    expect(readyChipText(row(C1))).toBe('Hazır: 3 top · 1.250 m');
    // Kısmen hazırın NEDENİ yazılır (işlemdeki top); "Kısmen hazır" başlığı tüm işler hazırken yanıltıyordu.
    expect(readyChipText(row(C1, { state: 'PARTIAL', inProcessCount: 16 }))).toBe('Hazır: 3 top · 1.250 m · 16 top işlemde');
  });
});

describe('SevkiyatScreen bağlantısı', () => {
  const src = readFileSync(path.join(__dirname, 'SevkiyatScreen.tsx'), 'utf8');
  it('şerit ve hazır iş sheet\'i yok; Paketleme yönlendirmesi yok', () => {
    expect(src).not.toMatch(/ReadyWorksStrip|ReadyWorksSheet|hazir-is-serit/);
    expect(src).not.toMatch(/nav\.navigate\('Paketleme'/);
  });
  it('board isteği hazır iş alanı taşımaz (ayrı uç)', () => {
    const svc = readFileSync(path.join(__dirname, '../../../services/packing.service.ts'), 'utf8');
    expect(svc).not.toMatch(/ready-works/);
  });
});
