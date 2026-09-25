import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';
import WorkOrderDetachSheet from './WorkOrderDetachSheet';
import { renderWithPaper } from '../../../test/render';

const mockCandidates = jest.fn();
const mockDetach = jest.fn();
jest.mock('../../../services/workOrder.service', () => ({
  workOrderService: {
    getDetachCandidates: (...a: unknown[]) => mockCandidates(...a),
    detachRoll: (...a: unknown[]) => mockDetach(...a),
  },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const WO = { id: 'wo-1', workOrderNumber: 'IE-1' };

async function saveDisabled(label: RegExp): Promise<boolean> {
  await act(async () => {});
  return screen.getByRole('button', { name: label }).props.accessibilityState?.disabled === true;
}

describe('WorkOrderDetachSheet', () => {
  beforeEach(() => {
    (Toast.show as jest.Mock).mockReset();
    mockDetach.mockReset();
    mockCandidates.mockReset().mockResolvedValue({
      data: [
        { id: 'r1', barcode: 'B-1', currentQty: 100, status: 'IN_PRODUCTION', detachable: true, blockers: [] },
        { id: 'r2', barcode: 'B-2', currentQty: 80, status: 'IN_PRODUCTION', detachable: true, blockers: [] },
        { id: 'r3', barcode: 'B-3', currentQty: 60, status: 'IN_PRODUCTION', detachable: false, blockers: ['istasyonda işlem gördü'] },
      ],
    });
  });

  it('işlem görmüş top seçilemez ve nedeni yazar; seçim yokken Çıkar kapalı', async () => {
    const onDone = jest.fn();
    renderWithPaper(<WorkOrderDetachSheet wo={WO} onDismiss={() => {}} onDone={onDone} />);
    await waitFor(() => expect(screen.getByText('B-3 · 60 m')).toBeTruthy());
    expect(screen.getByText(/Çıkarılamaz: istasyonda işlem gördü/)).toBeTruthy();
    fireEvent.press(screen.getByText('B-3 · 60 m'));
    expect(await saveDisabled(/Çıkar \(0\)/)).toBe(true);
  });

  it('seçilenler tek tek çıkarılır; kısmi hata tostla bildirilir', async () => {
    mockDetach.mockResolvedValueOnce({ data: { workOrderReverted: false } }).mockRejectedValueOnce({ response: { data: { message: 'Bu top işlem gördü (kesildi)' } } });
    const onDone = jest.fn();
    renderWithPaper(<WorkOrderDetachSheet wo={WO} onDismiss={() => {}} onDone={onDone} />);
    await waitFor(() => expect(screen.getByText('B-1 · 100 m')).toBeTruthy());
    fireEvent.press(screen.getByText('B-1 · 100 m'));
    fireEvent.press(screen.getByText('B-2 · 80 m'));
    expect(await saveDisabled(/Çıkar \(2\)/)).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: /Çıkar \(2\)/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockDetach).toHaveBeenNthCalledWith(1, 'wo-1', 'r1', 'Yanlış okutuldu');
    expect(mockDetach).toHaveBeenNthCalledWith(2, 'wo-1', 'r2', 'Yanlış okutuldu');
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text2: expect.stringContaining('1 top çıkarılamadı: Bu top işlem gördü (kesildi)') }));
  });
});
