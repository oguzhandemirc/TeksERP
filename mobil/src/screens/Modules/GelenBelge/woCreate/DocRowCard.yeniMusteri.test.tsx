// Belgeden İE formu — müşteri seçicisinin "Yeni müşteri ekle" kartı (saha 2026-11-10): yalnız ad alanı, "Diğer" açılınca ek
// alanlar, kayıt sonrası formda seçili, izinsizde soluk + açıklama, deneme başına token, listedeki eş ad uyarısı.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import DocRowCard from './DocRowCard';
import { resetCustomerOfferStore } from './customerOfferStore';
import { NO_PERMISSION_TEXT } from './useCustomerFromDoc';
import ModuleSheet from '../../../../components/ModuleSheet';
import type { DocRow, WoRowsState } from './useWoRows';
import type { RowForm } from './woFromDoc';

jest.mock('../useReadResult', () => ({
  useReadResult: () => ({
    watch: {
      phase: 'done',
      summary: {
        noteId: 'n1', noteNo: 'GB-1', noteStatus: 'DRAFT', state: 'READ', reason: null, pages: { total: 1, waiting: 0, read: 1, failed: 0 },
        lineCount: 0, reviewCount: 0, totals: { declared: false, ok: null, mismatches: [] }, warnings: [],
        ownerCustomerId: null, ownerSuggestion: null,
      },
    },
    recheck: jest.fn(),
  }),
}));
jest.mock('../useApprovalCard', () => ({ useApprovalDetail: () => ({ data: undefined, isError: false }) }));
let mockPerms: string[] = ['gelen-belge:write'];
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: (p: string) => mockPerms.includes(p) }) }));
const mockQuickCreate = jest.fn();
jest.mock('../../../../services/customer.service', () => ({ customerService: { quickCreate: (b: unknown) => mockQuickCreate(b) } }));

const form: RowForm = { ownerCustomerId: null, ownerSuggested: null, ownerAsk: null, ourBatchNo: 'P-1', ourBatchNoKey: null, meters: 300, metersReview: false, gramajValueId: null };
const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: { id: 'n1', noteNo: 'GB-1' } as DocRow['detail'], form, gramajTouched: false, result: null };
const wo = (updateForm: jest.Mock) =>
  ({ setDetail: jest.fn(), setParties: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), updateForm, showGramaj: false, catalog: { propertyId: null, options: [] } }) as unknown as WoRowsState;
const CUSTOMERS = [{ value: 'c1', label: 'MAVİ DERE TEKSTİL' }, { value: 'c2', label: 'KUZEY BOYA' }];
const flush = () => act(async () => {});
/** Kart açık mı — AppModal kapanışta solarak iner, düğüm bir süre ağaçta kalır; görünürlük prop'tan okunur. */
const sheetOpen = (ui: ReturnType<typeof renderWithPaper>) => ui.UNSAFE_getAllByType(ModuleSheet).some((x) => x.props.visible && x.props.title === 'Yeni müşteri');
const EXTRA_KEYS = ['taxNumber', 'contactName', 'contactPhone', 'email', 'city', 'district', 'address', 'notes'];

async function openAdd(updateForm = jest.fn()) {
  const ui = renderWithPaper(<DocRowCard row={row} wo={wo(updateForm)} customers={CUSTOMERS} customersLoading={false} />);
  await flush();
  fireEvent.press(ui.getByTestId('belge-satir-musteri-GB-1'));
  await flush();
  return ui;
}

beforeEach(() => {
  resetCustomerOfferStore();
  mockPerms = ['gelen-belge:write'];
  mockQuickCreate.mockReset();
});

describe('DocRowCard — seçicide "Yeni müşteri ekle"', () => {
  it('⭐ seçicide Yeni müşteri ekle kartı; basınca YALNIZ ad alanı (Diğer kapalı)', async () => {
    const ui = await openAdd();
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    expect(ui.getByTestId('musteri-yeni-ad')).toBeTruthy();
    expect(ui.getByTestId('musteri-yeni-diger')).toBeTruthy();
    expect(ui.queryByTestId('musteri-yeni-diger-alanlar')).toBeNull();
    for (const k of EXTRA_KEYS) expect(ui.queryByTestId(`musteri-yeni-${k}`)).toBeNull();
  });

  it('⭐ Diğer dokununca ek alanlar aşağı açılır, ikinci dokunuş kapatır', async () => {
    const ui = await openAdd();
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    fireEvent.press(ui.getByTestId('musteri-yeni-diger'));
    await flush();
    for (const k of EXTRA_KEYS) expect(ui.getByTestId(`musteri-yeni-${k}`)).toBeTruthy();
    fireEvent.press(ui.getByTestId('musteri-yeni-diger'));
    await flush();
    expect(ui.queryByTestId('musteri-yeni-diger-alanlar')).toBeNull();
  });

  it('⭐ kaydet → yalnız dolu alanlar gider, yeni müşteri formda seçili gelir', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'new1', name: 'YENİ FİRMA' } });
    const updateForm = jest.fn();
    const ui = await openAdd(updateForm);
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    fireEvent.changeText(ui.getByTestId('musteri-yeni-ad'), '  YENİ FİRMA ');
    await flush();
    fireEvent.press(ui.getByTestId('musteri-yeni-diger'));
    await flush();
    fireEvent.changeText(ui.getByTestId('musteri-yeni-city'), 'BURSA');
    await flush();
    fireEvent.changeText(ui.getByTestId('musteri-yeni-contactPhone'), '0532 000 00 00');
    await flush();
    fireEvent.changeText(ui.getByTestId('musteri-yeni-email'), '   ');
    await flush();
    fireEvent.press(ui.getByTestId('musteri-yeni-kaydet'));
    await flush();
    await waitFor(() => expect(updateForm).toHaveBeenCalledWith('n1', { ownerCustomerId: 'new1', ownerSuggested: null }));
    const body = mockQuickCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toEqual({ name: 'YENİ FİRMA', clientToken: expect.any(String), city: 'BURSA', contactPhone: '0532 000 00 00' });
    expect(sheetOpen(ui)).toBe(false);
  });

  it('⭐ izin yoksa kart soluk + açıklama; dokunmak formu açmaz', async () => {
    mockPerms = ['gelen-belge:read'];
    const ui = await openAdd();
    expect(ui.getByText(NO_PERMISSION_TEXT)).toBeTruthy();
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    expect(sheetOpen(ui)).toBe(false);
  });

  it('⭐ idempotency: belirsiz hatada aynı token; ad değişince ve kesin 4xx sonrası yeni token', async () => {
    const amb = { message: 'Ağ hatası' };
    mockQuickCreate.mockRejectedValueOnce(amb).mockRejectedValueOnce(amb).mockRejectedValueOnce(amb).mockRejectedValueOnce(amb)
      .mockRejectedValueOnce({ status: 400, message: 'E-posta adresi geçersiz görünüyor' }).mockRejectedValueOnce({ status: 409, message: 'çakışma' });
    const ui = await openAdd();
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    const type = async (id: string, v: string) => { fireEvent.changeText(ui.getByTestId(id), v); await flush(); };
    const press = async () => { fireEvent.press(ui.getByTestId('musteri-yeni-kaydet')); await flush(); };
    await type('musteri-yeni-ad', 'YENİ FİRMA');
    await press(); // t0 belirsiz
    await press(); // t1 = t0
    await type('musteri-yeni-ad', 'YENİ FİRMA 2');
    await press(); // t2 ≠ t1 (ad değişti)
    fireEvent.press(ui.getByTestId('musteri-yeni-diger'));
    await flush();
    await type('musteri-yeni-city', 'BURSA');
    await press(); // t3 ≠ t2 (dolu alan değişti)
    await press(); // t4 = t3, 400 → düşer
    await press(); // t5 ≠ t4
    const tokens = mockQuickCreate.mock.calls.map((c) => (c[0] as { clientToken: string }).clientToken);
    expect(tokens).toHaveLength(6);
    expect(tokens[1]).toBe(tokens[0]);
    expect(tokens[2]).not.toBe(tokens[1]);
    expect(tokens[3]).not.toBe(tokens[2]);
    expect(tokens[4]).toBe(tokens[3]);
    expect(tokens[5]).not.toBe(tokens[4]);
    expect(ui.getByTestId('musteri-yeni-hata')).toBeTruthy();
  });

  it('⭐ listede aynı ad varsa kaydet kapalı; uyarıdaki kayda dokunmak onu seçer', async () => {
    const updateForm = jest.fn();
    const ui = await openAdd(updateForm);
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    fireEvent.changeText(ui.getByTestId('musteri-yeni-ad'), 'mavi  dere tekstil');
    await flush();
    expect(ui.getByTestId('musteri-yeni-mukerrer')).toBeTruthy();
    fireEvent.press(ui.getByTestId('musteri-yeni-kaydet'));
    await flush();
    expect(mockQuickCreate).not.toHaveBeenCalled();
    fireEvent.press(ui.getByTestId('musteri-yeni-benzer-c1'));
    await flush();
    expect(updateForm).toHaveBeenCalledWith('n1', { ownerCustomerId: 'c1', ownerSuggested: null });
  });

  it('⭐ Vazgeç listeye döner; yeniden açılışta boş ad, Diğer kapalı', async () => {
    const ui = await openAdd();
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    fireEvent.changeText(ui.getByTestId('musteri-yeni-ad'), 'YARIM');
    await flush();
    fireEvent.press(ui.getByTestId('musteri-yeni-diger'));
    await flush();
    fireEvent.press(ui.getByTestId('musteri-yeni-vazgec'));
    await flush();
    expect(sheetOpen(ui)).toBe(false);
    expect(ui.getByText('Belgenin sahibi')).toBeTruthy();
    fireEvent.press(ui.getByText('Yeni müşteri ekle'));
    await flush();
    expect(sheetOpen(ui)).toBe(true);
    expect(ui.getByTestId('musteri-yeni-ad').props.value).toBe('');
    expect(ui.queryByTestId('musteri-yeni-diger-alanlar')).toBeNull();
  });
});
