// Kesilmiş topun etiket ad/renk/parti düzeltmesi (sevk edilene kadar):
// (1) saf kararlar: kilit nedeni, yalnız değişen alanlar gövdeye, boşaltılan '' gider, sebep sınırı;
// (2) pencere "fix" kipi: sebepsiz Kaydet kapalı; gövde + sebep PATCH'e gider; changed → onSaved;
// (3) "Bu işten çıkanlar" satırı: sevkli topta düzelt düğmesi yerine kilit, canlı topta düğme onFixLabel'ı çağırır.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburLabelInfoModal from './TamburLabelInfoModal';
import Toast from 'react-native-toast-message';
import WorkOrderOutputPanel from './WorkOrderOutputPanel';
import { labelTextFixBody, labelTextFixLockReason, labelTextFixReasonError } from './labelTextFix';
import { tamburService } from '../../../services/tambur.service';
import { rollService } from '../../../services/roll.service';
import type { Roll } from '../../../types/models';

jest.mock('../../../services/tambur.service', () => ({
  tamburService: { labelSuggestions: jest.fn(), labelSettings: jest.fn(), recentOutputRolls: jest.fn(), getLabelOverrides: jest.fn(), putLabelOverrides: jest.fn() },
}));
jest.mock('../../../services/roll.service', () => ({ rollService: { fixLabelTexts: jest.fn() } }));

const tsvc = tamburService as unknown as { labelSuggestions: jest.Mock; labelSettings: jest.Mock; recentOutputRolls: jest.Mock };
const rsvc = rollService as unknown as { fixLabelTexts: jest.Mock };
const flush = () => act(async () => { await Promise.resolve(); });
const noop = () => undefined;

beforeEach(() => {
  jest.clearAllMocks();
  tsvc.labelSuggestions.mockResolvedValue({ workOrderId: null, customerIds: [], itemNames: ['LALE'], colorNames: [], batchNos: [], last: null });
  tsvc.labelSettings.mockResolvedValue({ labelBatchEnabled: false });
});

describe('labelTextFix saf kararlar', () => {
  it('kilit: SHIPPED/fason/kartela/ölü kilitli, canlı statüler açık', () => {
    expect(labelTextFixLockReason('SHIPPED')).toMatch(/Sevk edildi/);
    expect(labelTextFixLockReason('AT_SUBCONTRACTOR')).toMatch(/Fason/);
    expect(labelTextFixLockReason('SCRAP')).toMatch(/kapanmış/);
    expect(labelTextFixLockReason('CANCELLED')).toMatch(/kapanmış/);
    for (const st of ['WAREHOUSE', 'A1_STOCK', 'STOCK', 'IN_PRODUCTION'] as const) expect(labelTextFixLockReason(st)).toBeNull();
  });

  it('gövde: yalnız değişen alan; boşaltılan alan "" (temizle); parti yalnız açıkken', () => {
    const cur = { itemName: 'SULTAN', colorName: 'EKRU', batchNo: 'J1' };
    expect(labelTextFixBody(cur, { itemName: ' SULTAN ', colorName: 'EKRU', batchNo: 'J1' }, true)).toEqual({});
    expect(labelTextFixBody(cur, { itemName: 'LALE', colorName: '', batchNo: 'J1' }, true)).toEqual({ labelItemName: 'LALE', labelColorName: '' });
    expect(labelTextFixBody(cur, { itemName: 'SULTAN', colorName: 'EKRU', batchNo: 'K2' }, false)).toEqual({});
    expect(labelTextFixBody(cur, { itemName: 'SULTAN', colorName: 'EKRU', batchNo: '' }, true)).toEqual({ labelBatchNo: '' });
    expect(labelTextFixBody({ itemName: null, colorName: undefined, batchNo: null }, { itemName: '', colorName: '', batchNo: '' }, true)).toEqual({});
  });

  it('sebep: 3–500', () => {
    expect(labelTextFixReasonError('ab')).not.toBeNull();
    expect(labelTextFixReasonError(' abc ')).toBeNull();
    expect(labelTextFixReasonError('x'.repeat(501))).not.toBeNull();
  });
});

describe('TamburLabelInfoModal fix kipi', () => {
  const roll = { id: 'r1', barcode: 'T0001', labelItemName: 'SULTAN', labelColorName: 'EKRU', labelBatchNo: null };

  it('sebepsiz Kaydet kapalı; seçilen değer + sebep PATCH gövdesine gider; changed → onSaved', async () => {
    rsvc.fixLabelTexts.mockResolvedValue({ success: true, data: { rollId: 'r1', labelItemName: 'LALE', labelColorName: null, labelBatchNo: null, changed: true } });
    const onSaved = jest.fn();
    const onDismiss = jest.fn();
    const r = renderWithPaper(<TamburLabelInfoModal mode="fix" visible roll={roll} onDismiss={onDismiss} onSaved={onSaved} />);
    await flush();
    expect(r.getByText('Etiket bilgisini düzelt — T0001')).toBeTruthy();
    expect(r.getByTestId('etiket-item-deger').props.children).toBe('SULTAN');
    expect(r.queryByTestId('etiket-diger-alanlar')).toBeNull();
    expect(r.queryByTestId('etiket-batch')).toBeNull();
    expect(r.getByTestId('etiket-bilgisi-kaydet')).toBeDisabled();

    fireEvent.press(r.getByTestId('etiket-item'));
    await flush();
    await waitFor(() => expect(r.getByText('LALE')).toBeTruthy());
    fireEvent.press(r.getByText('LALE'));
    await flush();
    fireEvent.press(r.getByTestId('etiket-color-temizle'));
    fireEvent.changeText(r.getByTestId('etiket-duzelt-sebep'), 'Müşteri yanlış dedi');
    await flush();
    expect(r.getByTestId('etiket-bilgisi-kaydet')).not.toBeDisabled();
    fireEvent.press(r.getByTestId('etiket-bilgisi-kaydet'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(rsvc.fixLabelTexts).toHaveBeenCalledWith('r1', { labelItemName: 'LALE', labelColorName: '', reason: 'Müşteri yanlış dedi' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('topta parti varsa ayar kapalıyken de parti alanı çizilir (temizlenebilsin)', async () => {
    const r = renderWithPaper(<TamburLabelInfoModal mode="fix" visible roll={{ ...roll, labelBatchNo: 'J1' }} onDismiss={noop} onSaved={noop} />);
    await flush();
    expect(r.getByTestId('etiket-batch-deger').props.children).toBe('J1');
  });
});

describe('WorkOrderOutputPanel etiket düzelt düğmesi', () => {
  const mk = (id: string, status: Roll['status']) =>
    ({ id, barcode: `B-${id}`, status, initialQty: 10, currentQty: 10, createdAt: '2026-11-09T10:00:00Z' }) as unknown as Roll;

  it('satırda yalnız bas + geri al; düzelt satır menüsünde (dokun / uzun bas); sevkli topta kilit + menü öğesi kapalı', async () => {
    tsvc.recentOutputRolls.mockResolvedValue({ success: true, data: [{ ...mk('a', 'WAREHOUSE'), weightKg: 12.5 }, mk('b', 'SHIPPED')] });
    const onFix = jest.fn();
    const r = renderWithPaper(<WorkOrderOutputPanel workOrderId="wo1" fill onPrint={noop} onUndo={noop} onFixLabel={onFix} />);
    await waitFor(() => expect(r.getByText('B-a')).toBeTruthy());
    expect(r.queryByTestId('wo-output-etiket-duzelt-a')).toBeNull();
    expect(r.getAllByLabelText('Etiketi bas')).toHaveLength(2);
    expect(r.getAllByLabelText('Geri al')).toHaveLength(2);
    expect(r.getByTestId('wo-output-kg-a')).toHaveTextContent('12.5 kg');
    expect(r.getByTestId('wo-output-kg-b')).toHaveTextContent('—');
    expect(r.getByTestId('wo-output-ozet')).toHaveTextContent('2 top · 20.0 m · 12.5 kg');
    expect(r.getByTestId('wo-output-etiket-kilit-b')).toBeTruthy();
    fireEvent(r.getByTestId('wo-output-satir-a'), 'longPress');
    await waitFor(() => expect(r.getByTestId('wo-output-etiket-duzelt-a')).toBeTruthy());
    fireEvent.press(r.getByTestId('wo-output-etiket-duzelt-a'));
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    fireEvent.press(r.getByTestId('wo-output-satir-b'));
    await waitFor(() => expect(r.getByTestId('wo-output-etiket-duzelt-b')).toBeTruthy());
    fireEvent.press(r.getByTestId('wo-output-etiket-duzelt-b'));
    expect(onFix).toHaveBeenCalledTimes(1);
  });

  it('onFixLabel verilmezse düğme hiç çizilmez (eski çağıranlar aynı)', async () => {
    tsvc.recentOutputRolls.mockResolvedValue({ success: true, data: [mk('a', 'WAREHOUSE')] });
    const r = renderWithPaper(<WorkOrderOutputPanel workOrderId="wo1" onPrint={noop} onUndo={noop} />);
    await waitFor(() => expect(r.getByText('B-a')).toBeTruthy());
    expect(r.queryByTestId('wo-output-etiket-duzelt-a')).toBeNull();
  });
});

// Çıkan etiketler yenilemesi: 15 sn yoklama SESSİZ — tost yalnız operatör ↻'e bastığında (2026-11-11).
describe('Çıkan etiketler ↻ elle yenileme', () => {
  const mk = (id: string, status: Roll['status']) =>
    ({ id, barcode: `B-${id}`, status, initialQty: 10, currentQty: 10, createdAt: '2026-11-09T10:00:00Z' }) as unknown as Roll;

  it('ilk yükleme tostsuz; ↻ → dönüş bitince "yenilendi" tostu', async () => {
    const show = jest.spyOn(Toast, 'show').mockImplementation(() => undefined);
    tsvc.recentOutputRolls.mockResolvedValue({ success: true, data: [mk('a', 'WAREHOUSE')] });
    const r = renderWithPaper(<WorkOrderOutputPanel workOrderId="wo1" onPrint={noop} onUndo={noop} />);
    await waitFor(() => expect(r.getByText('B-a')).toBeTruthy());
    expect(show).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('wo-output-yenile'));
    await waitFor(() => expect(show).toHaveBeenCalledWith({ type: 'success', text1: 'Çıkan etiketler yenilendi' }), { timeout: 3000 });
    show.mockRestore();
  });

  it('hata → "Yenilenemedi: <neden>" tostu', async () => {
    const show = jest.spyOn(Toast, 'show').mockImplementation(() => undefined);
    tsvc.recentOutputRolls.mockResolvedValueOnce({ success: true, data: [mk('a', 'WAREHOUSE')] });
    const r = renderWithPaper(<WorkOrderOutputPanel workOrderId="wo1" onPrint={noop} onUndo={noop} />);
    await waitFor(() => expect(r.getByText('B-a')).toBeTruthy());
    tsvc.recentOutputRolls.mockRejectedValue(new Error('Sunucu hatası'));
    fireEvent.press(r.getByTestId('wo-output-yenile'));
    await waitFor(() => expect(show).toHaveBeenCalledWith({ type: 'error', text1: 'Yenilenemedi: Sunucu hatası' }), { timeout: 3000 });
    show.mockRestore();
  });
});
