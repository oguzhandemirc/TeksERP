// Belge satırı — "müşteri kayıtlı değil" tetikleyicisi (Gülkesim 2026-11-04): okuma özetinde `ownerUnmatched` varken ve
// müşteri seçili değilken görünür; kayıt sonrası müşteri formda seçili gelir. Seçiliyse ya da alan yoksa tetikleyici yok.
// 2026-11-05: teklif okuma bitince kendiliğinden modal olarak açılır; "Listeden seç" satırın müşteri seçicisini açar.
// Negatif sonda (2026-11-04, ölçüldü): DocRowCard'da `!f.ownerCustomerId` koşulu kaldırılınca "seçiliyse yok" kırmızı.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import DocRowCard from './DocRowCard';
import { resetCustomerOfferStore } from './customerOfferStore';
import ModuleSheet from '../../../../components/ModuleSheet';
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
  resetCustomerOfferStore();
  mockUnmatched = { text: 'YENI TEKSTIL', candidates: [] };
  mockQuickCreate.mockReset();
});

describe('DocRowCard — müşteri kayıtlı değil tetikleyicisi', () => {
  it('⭐ müşteri boş + ownerUnmatched → teklif kendiliğinden açılır; kayıt sonrası müşteri formda seçili', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'new1', name: 'YENI TEKSTIL' } });
    const updateForm = jest.fn();
    const ui = renderWithPaper(<DocRowCard row={row(form)} wo={wo(updateForm)} customers={[]} customersLoading={false} />);
    await flush();
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(updateForm).toHaveBeenCalledWith('n1', { ownerCustomerId: 'new1', ownerSuggested: null }));
  });
  it('⭐ Listeden seç → satırın müşteri seçicisi açılır', async () => {
    const ui = renderWithPaper(<DocRowCard row={row(form)} wo={wo(jest.fn())} customers={[{ value: 'c9', label: 'KAYITLI FIRMA' }]} customersLoading={false} />);
    await flush();
    fireEvent.press(ui.getByTestId('musteri-ekle-listeden'));
    await flush();
    await waitFor(() => expect(ui.getByText('Belgenin sahibi')).toBeTruthy());
    expect(ui.UNSAFE_getAllByType(ModuleSheet).filter((x) => x.props.visible && String(x.props.title).includes('müşteri'))).toEqual([]);
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
