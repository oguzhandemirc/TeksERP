// Belge satırı — "müşteri kayıtlı değil" tetikleyicisi (Gülkesim 2026-11-04): okuma özetinde `ownerUnmatched` varken ve
// müşteri seçili değilken görünür; kayıt sonrası müşteri formda seçili gelir. Seçiliyse ya da alan yoksa tetikleyici yok.
// Negatif sonda (2026-11-04, ölçüldü): DocRowCard'da `!f.ownerCustomerId` koşulu kaldırılınca "seçiliyse yok" kırmızı.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import DocRowCard from './DocRowCard';
import type { DocRow, WoRowsState } from './useWoRows';
import type { RowForm } from './woFromDoc';

let mockUnmatched: unknown = { text: 'YENI TEKSTIL', candidates: [] };
jest.mock('../useReadResult', () => ({
  useReadResult: () => ({
    watch: {
      phase: 'done',
      summary: {
        noteId: 'n1', noteNo: 'GB-1', noteStatus: 'DRAFT', state: 'READ', reason: null, pages: { total: 1, waiting: 0, read: 1, failed: 0 },
        lineCount: 0, reviewCount: 0, totals: { declared: false, ok: null, mismatches: [] }, warnings: [],
        ownerCustomerId: null, ownerSuggestion: null, ownerUnmatched: mockUnmatched,
      },
    },
    recheck: jest.fn(),
  }),
}));
jest.mock('../useApprovalCard', () => ({ useApprovalDetail: () => ({ data: undefined, isError: false }) }));
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: () => true }) }));
const mockQuickCreate = jest.fn();
jest.mock('../../../../services/customer.service', () => ({ customerService: { quickCreate: (b: unknown) => mockQuickCreate(b) } }));

const form: RowForm = { ownerCustomerId: null, ownerSuggested: null, ownerAsk: null, ourBatchNo: 'P-1', ourBatchNoKey: null, meters: 300, metersReview: false, gramajValueId: null };
const row = (f: RowForm): DocRow => ({ noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: { id: 'n1', noteNo: 'GB-1' } as DocRow['detail'], form: f, gramajTouched: false, result: null });
const wo = (updateForm: jest.Mock) =>
  ({ setDetail: jest.fn(), setParties: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), updateForm, showGramaj: false, catalog: { propertyId: null, options: [] } }) as unknown as WoRowsState;
const flush = () => act(async () => {});

beforeEach(() => {
  mockUnmatched = { text: 'YENI TEKSTIL', candidates: [] };
  mockQuickCreate.mockReset();
});

describe('DocRowCard — müşteri kayıtlı değil tetikleyicisi', () => {
  it('⭐ müşteri boş + ownerUnmatched → teklif; kayıt sonrası müşteri formda seçili', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'new1', name: 'YENI TEKSTIL' } });
    const updateForm = jest.fn();
    const ui = renderWithPaper(<DocRowCard row={row(form)} wo={wo(updateForm)} customers={[]} customersLoading={false} />);
    await flush();
    fireEvent.press(ui.getByTestId('belge-satir-musteri-ekle-GB-1'));
    await flush();
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(updateForm).toHaveBeenCalledWith('n1', { ownerCustomerId: 'new1', ownerSuggested: null }));
  });
  it('⭐ müşteri seçiliyse teklif yok', async () => {
    const ui = renderWithPaper(<DocRowCard row={row({ ...form, ownerCustomerId: 'c1' })} wo={wo(jest.fn())} customers={[]} customersLoading={false} />);
    await flush();
    expect(ui.queryByTestId('belge-satir-musteri-ekle-GB-1')).toBeNull();
  });
  it('eski sunucu (alan yok) → teklif yok', async () => {
    mockUnmatched = undefined;
    const ui = renderWithPaper(<DocRowCard row={row(form)} wo={wo(jest.fn())} customers={[]} customersLoading={false} />);
    await flush();
    expect(ui.queryByTestId('belge-satir-musteri-ekle-GB-1')).toBeNull();
  });
});
