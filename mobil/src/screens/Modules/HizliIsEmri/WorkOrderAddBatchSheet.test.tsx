// Negatif sonda (2026-09-26): kumaş kilidi kaldırılınca 1. test, anahtar yapışması kaldırılınca 2. test kırmızı.
import React from 'react';
import { Text as RNText, TouchableOpacity } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';
import WorkOrderAddBatchSheet from './WorkOrderAddBatchSheet';
import { renderWithPaper } from '../../../test/render';

const mockAdd = jest.fn();
const mockByBarcode = jest.fn();
jest.mock('../../../services/workOrderBatch.service', () => ({ workOrderBatchService: { addBatch: (...a: unknown[]) => mockAdd(...a) } }));
jest.mock('../../../services/roll.service', () => ({ rollService: { getByBarcode: (...a: unknown[]) => mockByBarcode(...a) } }));
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../components/RollPickerModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/BarcodeScannerModal', () => {
  const RN = jest.requireActual('react-native');
  return {
    BarcodeScannerModal: ({ visible, onScan }: { visible: boolean; onScan: (b: string) => void }) =>
      visible ? (
        <>
          <RN.TouchableOpacity onPress={() => onScan('b-1')}><RN.Text>sonda-okut-B1</RN.Text></RN.TouchableOpacity>
          <RN.TouchableOpacity onPress={() => onScan('B-2')}><RN.Text>sonda-okut-B2</RN.Text></RN.TouchableOpacity>
        </>
      ) : null,
  };
});
void RNText; void TouchableOpacity;

const WO = { id: 'wo-1', workOrderNumber: 'IE-1', targetItemId: 'i1', steps: [{ stepSequence: 2, station: { name: 'Tambur' } }, { stepSequence: 1, station: { name: 'Kurşun' } }] };
const ROLLS: Record<string, unknown> = {
  'B-1': { id: 'r1', barcode: 'B-1', itemId: 'i1', status: 'STOCK', currentQty: 100, width: 180 },
  'B-2': { id: 'r2', barcode: 'B-2', itemId: 'i9', status: 'STOCK', currentQty: 80, width: 180 },
};

async function okut(label: string) {
  fireEvent.press(screen.getByText(label));
  await act(async () => {});
}

describe('WorkOrderAddBatchSheet', () => {
  beforeEach(() => {
    (Toast.show as jest.Mock).mockReset();
    mockAdd.mockReset();
    mockByBarcode.mockReset().mockImplementation((b: string) => Promise.resolve({ data: ROLLS[b] }));
  });

  it('okutulan top listeye girer (küçük harf normalleşir), farklı kumaş girmez; Kaydet yeni partiyi ister', async () => {
    mockAdd.mockResolvedValue({ message: 'P07 partisi eklendi · 1 top', data: { warnings: ['Hedef 150 m, iş emrindeki toplam 200 m.'] } });
    const onDone = jest.fn();
    renderWithPaper(<WorkOrderAddBatchSheet wo={WO} onDismiss={() => {}} onDone={onDone} />);
    fireEvent.press(screen.getByText('Top Okut'));
    await act(async () => {});
    await okut('sonda-okut-B1');
    await okut('sonda-okut-B2');
    expect(mockByBarcode).toHaveBeenCalledWith('B-1');
    expect(screen.getByText('B-1 · 100 m')).toBeTruthy();
    expect(screen.queryByText('B-2 · 80 m')).toBeNull();
    expect(screen.getByText('Yeni parti açılacak · 1 top · 100 m · ilk adım: Kurşun')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /Parti Ekle \(1\)/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockAdd).toHaveBeenCalledWith('wo-1', { clientToken: expect.any(String), rollBarcodes: ['B-1'] });
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text2: 'Hedef 150 m, iş emrindeki toplam 200 m.' }));
  });

  it('belirsiz hatada aynı anahtar tekrar gider; kesin retten sonra yeni anahtar, ret satırı görünür', async () => {
    mockAdd
      .mockRejectedValueOnce(Object.assign(new Error('Sunucu hatası'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('Parti eklenemedi'), { status: 400, details: { code: 'BATCH_ADD_REJECTED', rejects: [{ barcode: 'B-1', reason: 'Top stokta değil (IN_PRODUCTION)' }] } }))
      .mockResolvedValueOnce({ message: 'ok', data: { warnings: [] } });
    renderWithPaper(<WorkOrderAddBatchSheet wo={WO} onDismiss={() => {}} onDone={() => {}} />);
    fireEvent.press(screen.getByText('Top Okut'));
    await act(async () => {});
    await okut('sonda-okut-B1');
    const kaydet = () => fireEvent.press(screen.getByRole('button', { name: /Parti Ekle \(1\)/ }));
    kaydet();
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    kaydet();
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('B-1 — Top stokta değil (IN_PRODUCTION)')).toBeTruthy();
    kaydet();
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(3));
    const [t1, t2, t3] = mockAdd.mock.calls.map((c) => (c[1] as { clientToken: string }).clientToken);
    expect(t2).toBe(t1);
    expect(t3).not.toBe(t1);
  });
});
