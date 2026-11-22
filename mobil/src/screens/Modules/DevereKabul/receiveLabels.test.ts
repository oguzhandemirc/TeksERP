// Devere Dönüş Kabulü — kabul sonrası levent ETİKETİ: kart ayarı OFF → kuyruğa; ASK/ALWAYS → girmez (kart yerini alır).
import type { ReceiveDocResult } from '../../../services/devereKabul.service';
import { useBeamLabelQueue } from '../Devere/beamLabelQueue';
import { labelsAutoQueued, normalizeAutoPrint } from './useBeamCardPrint';
import { queueReceiveLabels } from './useReceiveSubmit';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../../services/devereKabul.service', () => ({ devereKabulService: {} }));
jest.mock('../Devere/beamLabelQueue', () => {
  const enqueue = jest.fn();
  return { useBeamLabelQueue: { getState: () => ({ enqueue }) } };
});
const enqueue = useBeamLabelQueue.getState().enqueue as jest.Mock;

const res = {
  docNo: 'DK-1',
  totals: { beamCount: 2, lengthM: '2960' },
  orders: [
    { warpingOrderId: 'o1', orderNo: 'FDV-1', receipt: { beams: [{ id: 'wb1', beamNo: 'LV-7', physicalBeamNo: null, lengthM: '1480' }] } },
    { warpingOrderId: 'o2', orderNo: 'FDV-2', receipt: { beams: [{ id: 'wb2', beamNo: 'LV-8', physicalBeamNo: null, lengthM: '1480' }] } },
  ],
} as unknown as ReceiveDocResult;

beforeEach(() => enqueue.mockReset());

test('kart ayarı → etiket kendiliğinden mi? yalnız OFF (eski sunucu / tanınmayan = OFF)', () => {
  expect(labelsAutoQueued(normalizeAutoPrint(undefined))).toBe(true);
  expect(labelsAutoQueued(normalizeAutoPrint('OFF'))).toBe(true);
  expect(labelsAutoQueued(normalizeAutoPrint('ASK'))).toBe(false);
  expect(labelsAutoQueued(normalizeAutoPrint('ALWAYS'))).toBe(false);
});

test('OFF: her levent etiketi kuyruğa (bugünkü davranış)', () => {
  expect(queueReceiveLabels(res, true)).toBe(2);
  expect(enqueue.mock.calls).toEqual([['wb1', 'LV-7'], ['wb2', 'LV-8']]);
});

test('ASK/ALWAYS: etiket kuyruğa girmez', () => {
  expect(queueReceiveLabels(res, false)).toBe(0);
  expect(enqueue).not.toHaveBeenCalled();
});
