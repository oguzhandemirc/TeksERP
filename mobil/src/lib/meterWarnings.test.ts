// D4-B5k: ölçüm yanıtındaki kalibrasyon notu tablette toast olur; notsuz yanıt (KAPALI / eski sunucu) sessiz.
import Toast from 'react-native-toast-message';
import { METER_WARNING_DELAY_MS, showMeterWarnings } from './meterWarnings';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
const show = Toast.show as jest.Mock;

beforeEach(() => {
  show.mockClear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('showMeterWarnings', () => {
  it('warnings yok / boş / eski sunucu → toast YOK, yanıt aynı nesne', () => {
    const plain = { success: true, data: { id: 1 } };
    expect(showMeterWarnings(plain)).toBe(plain);
    showMeterWarnings({ success: true, data: null, warnings: [] });
    showMeterWarnings(null);
    jest.runAllTimers();
    expect(show).not.toHaveBeenCalled();
  });
  it('kalibrasyon notu → başarı toast\'ından SONRA bilgi toast\'ı', () => {
    const note = 'Sayaç S1 (M-1) kalibrasyon süresi 30.10.2026 tarihinde doldu — ölçüm kaydedildi, sayacı kalibre ettirin.';
    showMeterWarnings({ success: true, data: {}, warnings: [note] });
    expect(show).not.toHaveBeenCalled();
    jest.advanceTimersByTime(METER_WARNING_DELAY_MS);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text2: note }));
  });
});
