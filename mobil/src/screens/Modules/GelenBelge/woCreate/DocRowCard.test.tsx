// Belge satırı (K6/K8): detay ucu `gelen-belge:read` ister — izin yoksa ya da düşerse form okuma özetinden dolar
// (sessiz "okunuyor" çıkmazı yok); okuma düşse de (FAILED) form dolar, değerler elle girilir.
// Negatif sonda: DocRowCard'daki özet yedeği kaldırılınca "detay 403" ve "izin yok" vakaları kırmızı.
import React from 'react';
import { renderWithPaper } from '../../../../test/render';
import DocRowCard from './DocRowCard';
import type { DocRow, WoRowsState } from './useWoRows';

const mockDetail = { data: undefined as unknown, isError: false };
const mockEnabled: boolean[] = [];
let mockCanRead = true;
let mockState = 'READ';
jest.mock('../useReadResult', () => ({
  useReadResult: () => ({
    watch: {
      phase: 'done',
      summary: {
        noteId: 'n1', noteNo: 'GB-1', noteStatus: 'DRAFT', state: mockState, reason: null, pages: { total: 1, waiting: 0, read: 1, failed: 0 },
        lineCount: 0, reviewCount: 0, totals: { declared: false, ok: null, mismatches: [] }, warnings: [],
        ownerCustomerId: null, ourBatchNo: 'P-1', ourBatchNoKey: 'K1', kursunMeters: '250', kursunMetersReview: false,
        ownerSuggestion: { customerId: 'c9', name: 'Gülkesim', matchedText: 'GULKESIM', source: 'OWNER_TEXT' },
      },
    },
    recheck: jest.fn(),
  }),
}));
jest.mock('../useApprovalCard', () => ({
  useApprovalDetail: (_id: string, enabled: boolean) => {
    mockEnabled.push(enabled);
    return enabled ? mockDetail : { data: undefined, isError: false };
  },
}));
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: (c: string) => (c === 'gelen-belge:read' ? mockCanRead : true) }) }));

const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: null, form: null, gramajTouched: false, result: null };
const wo = (setDetail: jest.Mock) =>
  ({ setDetail, recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), updateForm: jest.fn(), showGramaj: false, catalog: { propertyId: null, options: [] } }) as unknown as WoRowsState;

beforeEach(() => {
  mockDetail.data = undefined;
  mockDetail.isError = false;
  mockEnabled.length = 0;
  mockCanRead = true;
  mockState = 'READ';
});

describe('DocRowCard — detay okunamazsa form özetten dolar', () => {
  it('⭐ detay 403 → özetten setDetail + "detay okunamadı" notu', () => {
    mockDetail.isError = true;
    const setDetail = jest.fn();
    const ui = renderWithPaper(<DocRowCard row={row} wo={wo(setDetail)} customers={[]} customersLoading={false} />);
    expect(setDetail).toHaveBeenCalledWith('n1', expect.objectContaining({ id: 'n1', ourBatchNo: 'P-1', kursunMeters: '250' }));
    expect(ui.getByTestId('belge-satir-detay-hata-GB-1')).toBeTruthy();
  });
  it('⭐ gelen-belge:read yok → detay ucu çağrılmaz, form özetten dolar', () => {
    mockCanRead = false;
    const setDetail = jest.fn();
    const ui = renderWithPaper(<DocRowCard row={row} wo={wo(setDetail)} customers={[]} customersLoading={false} />);
    expect(mockEnabled.every((e) => e === false)).toBe(true);
    expect(setDetail).toHaveBeenCalledWith('n1', expect.objectContaining({ id: 'n1' }));
    expect(ui.queryByTestId('belge-satir-detay-hata-GB-1')).toBeNull();
  });
  it('⭐ okuma düştü (FAILED) → detay yine istenir (form elle doldurulur)', () => {
    mockState = 'FAILED';
    mockDetail.data = { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', ownerCustomerId: null };
    const setDetail = jest.fn();
    renderWithPaper(<DocRowCard row={row} wo={wo(setDetail)} customers={[]} customersLoading={false} />);
    expect(mockEnabled).toContain(true);
    expect(setDetail).toHaveBeenCalledWith('n1', mockDetail.data);
  });
});
