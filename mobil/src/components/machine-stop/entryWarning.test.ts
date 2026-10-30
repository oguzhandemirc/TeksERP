// D4-A2b: açık duruş giriş uyarısı — UYARIR, gönderimi kesmez (K2); koşul kapalıyken Toast yok.
import Toast from 'react-native-toast-message';
import { showStopOpenEntryWarning, stopOpenEntryWarning } from './entryWarning';
import { stopOpenTapWarning } from '../../screens/Modules/KursunQc/gramajTap';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

describe('açık duruş giriş uyarısı (D4-A2b)', () => {
  it('koşul kapalı → metin yok, Toast yok', () => {
    expect(stopOpenEntryWarning(false)).toBeNull();
    showStopOpenEntryWarning(false);
    expect(Toast.show).not.toHaveBeenCalled();
  });

  it('koşul açık → bilgi Toast\'u (ret değil)', () => {
    showStopOpenEntryWarning(true);
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text1: 'Makine duruşta görünüyor — dokunuş engellenmedi' }));
  });

  it('Kurşun gramaj uyarısı aynı tek kaynaktan', () => {
    expect(stopOpenTapWarning).toBe(stopOpenEntryWarning);
  });
});
