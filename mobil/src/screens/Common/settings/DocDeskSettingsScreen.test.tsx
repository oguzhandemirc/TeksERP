// Bekçi: Ayarlar → Belge Masası → Belge çekimi. "Canlı okuma" YALNIZ canlı kamera modülü olan APK'da listelenir;
// eski APK'da gizlidir ve kayıtlı 'live' bugünkü kendi kamerayı seçili gösterir. Menü özeti seçimi yansıtır.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import DocDeskSettingsScreen, { docDeskSummary, engineOptions } from './DocDeskSettingsScreen';
import { renderWithPaper } from '../../../test/render';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { isLiveCameraAvailable } from '../../../services/liveCamera';
import { checkDocScanner } from '../../../services/docScannerNative';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('../../../services/liveCamera', () => ({ isLiveCameraAvailable: jest.fn(() => false) }));

jest.mock('../../../services/docScannerNative', () => ({ checkDocScanner: jest.fn(async () => ({ available: true, reason: 'ok' })) }));

const liveAvailable = isLiveCameraAvailable as jest.Mock;
const checkScanner = checkDocScanner as jest.Mock;

beforeEach(() => {
  useDeviceSettingsStore.setState({ docScanEngine: 'camera', docDeskDevice: false, docDeskCaptureMode: 'tap' });
});

describe('DocDeskSettingsScreen — canlı okuma seçeneği', () => {
  it('⭐ eski APK (modül yok): "Canlı okuma" listelenmez', () => {
    liveAvailable.mockReturnValue(false);
    renderWithPaper(<DocDeskSettingsScreen />);
    expect(screen.getByTestId('ayar-belge-cekim-camera')).toBeTruthy();
    expect(screen.queryByTestId('ayar-belge-cekim-live')).toBeNull();
    expect(engineOptions(false).map((o) => o.value)).toEqual(['camera', 'mlkit']);
  });

  it('⭐ eski APK + kayıtlı "live": kendi kamera seçili görünür', () => {
    liveAvailable.mockReturnValue(false);
    useDeviceSettingsStore.setState({ docScanEngine: 'live' });
    renderWithPaper(<DocDeskSettingsScreen />);
    expect(screen.getByTestId('ayar-belge-cekim-camera').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('yeni APK: "Canlı okuma" listelenir ve seçilince kaydolur; varsayılan değişmez', () => {
    liveAvailable.mockReturnValue(true);
    const setEngine = jest.fn(async () => undefined);
    useDeviceSettingsStore.setState({ setDocScanEngine: setEngine });
    renderWithPaper(<DocDeskSettingsScreen />);
    expect(screen.getByTestId('ayar-belge-cekim-camera').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId('ayar-belge-cekim-live'));
    expect(setEngine).toHaveBeenCalledWith('live');
  });

  it('menü özeti seçimi yansıtır', () => {
    expect(docDeskSummary(false, 'tap', 'live')).toBe('Kapalı · dokunarak çekim · canlı okuma');
    expect(docDeskSummary(false, 'tap', 'camera')).toBe('Kapalı · dokunarak çekim');
  });
});

describe('DocDeskSettingsScreen — flaş', () => {
  it('⭐ "Flaşı otomatik aç" varsayılan açık görünür; dokununca kapatılır', () => {
    const setTorch = jest.fn(async () => undefined);
    useDeviceSettingsStore.setState({ docTorchAuto: true, setDocTorchAuto: setTorch });
    renderWithPaper(<DocDeskSettingsScreen />);
    expect(screen.getByText('Flaşı otomatik aç')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ayar-flas-otomatik'));
    expect(setTorch).toHaveBeenCalledWith(false);
  });
});

describe('DocDeskSettingsScreen — Google tarayıcı durumu', () => {
  beforeEach(() => checkScanner.mockClear());

  it('⭐ Google seçili değilken durum sorulmaz, satır yok', () => {
    renderWithPaper(<DocDeskSettingsScreen />);
    expect(screen.queryByTestId('ayar-belge-cekim-durum')).toBeNull();
    expect(checkScanner).not.toHaveBeenCalled();
  });

  it('⭐ Google seçiliyken bir kez sorulur: hazır', async () => {
    useDeviceSettingsStore.setState({ docScanEngine: 'mlkit' });
    renderWithPaper(<DocDeskSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('ayar-belge-cekim-durum')).toHaveTextContent('Durum: hazır'));
    expect(checkScanner).toHaveBeenCalledTimes(1);
  });

  it('bileşen inmemiş → "indiriliyor"; modül yok → "bu sürümde yok"', async () => {
    useDeviceSettingsStore.setState({ docScanEngine: 'mlkit' });
    checkScanner.mockResolvedValueOnce({ available: false, reason: 'module_missing' });
    const first = renderWithPaper(<DocDeskSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('ayar-belge-cekim-durum')).toHaveTextContent(/bileşen indiriliyor/));
    first.unmount();
    checkScanner.mockResolvedValueOnce({ available: false, reason: 'no_module' });
    renderWithPaper(<DocDeskSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('ayar-belge-cekim-durum')).toHaveTextContent('Durum: bu sürümde yok'));
  });
});
