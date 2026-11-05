// Bekçi: Ayarlar → Belge Masası → Belge çekimi. "Canlı okuma" YALNIZ canlı kamera modülü olan APK'da listelenir;
// eski APK'da gizlidir ve kayıtlı 'live' bugünkü kendi kamerayı seçili gösterir. Menü özeti seçimi yansıtır.
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import DocDeskSettingsScreen, { docDeskSummary, engineOptions } from './DocDeskSettingsScreen';
import { renderWithPaper } from '../../../test/render';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { isLiveCameraAvailable } from '../../../services/liveCamera';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('../../../services/liveCamera', () => ({ isLiveCameraAvailable: jest.fn(() => false) }));

const liveAvailable = isLiveCameraAvailable as jest.Mock;

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
