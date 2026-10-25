// =============================================================================
// Bekçi: Ayarlar → Basım Raporları (bulunabilirlik + bekleyen raporun görünürlüğü, A4)
// =============================================================================
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderWithPaper } from '../../../test/render';
import { apiClient } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import { __resetPrintReportsForTests, reportPrintJob } from '../../../services/printJob.service';
import { PrintReportsScreen } from './PrintReportsScreen';
import SettingsScreen from '../SettingsScreen';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn(), navigate: mockNavigate }) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('../../../services/api', () => ({ apiClient: { post: jest.fn(async () => ({ data: {} })), get: jest.fn() } }));
jest.mock('../../../hooks/useLicenseStatus', () => ({ useLicenseStatus: () => ({ data: undefined }) }));
jest.mock('../../../hooks/useSubcontractorDefault', () => ({ useSubcontractorDefault: () => ({ mode: 'lastUsed' }) }));

const HATA = {
  subjectKind: 'ETIKET_CUVAL' as const,
  subjectNo: 'C-0042',
  status: 'HATA' as const,
  transport: 'BLUETOOTH' as const,
  printerName: 'Çuval Yazıcı',
  printerAddress: '00:11:22:33:44:55',
  errorCode: 'BT_BAGLANTI',
  errorMessage: 'Yazıcıya bağlanılamadı',
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear(); // önceki testin diskteki kuyruğu hydrate ile geri gelmesin
  __resetPrintReportsForTests();
  useAuthStore.setState({ token: 'jwt', user: { userId: 'u1', username: 'op', permissions: [] } });
  onlineManager.setOnline(false);
});

it('Ayarlar menüsünde "Basım Raporları" satırı bekleyen hatayı özetler ve ekranı açar', () => {
  reportPrintJob(HATA);
  renderWithPaper(<SettingsScreen />);
  expect(screen.getByText('Basım Raporları')).toBeTruthy();
  expect(screen.getByText('1 rapor gönderilmeyi bekliyor · 1 hata')).toBeTruthy();
  fireEvent.press(screen.getByText('Basım Raporları'));
  expect(mockNavigate).toHaveBeenCalledWith('SettingsPrintReports');
});

it('ekran bekleyen raporu yazıcı + Türkçe nedenle listeler; "Şimdi gönder" kuyruğu boşaltır', async () => {
  reportPrintJob(HATA);
  renderWithPaper(<PrintReportsScreen />);
  expect(screen.getByText('Çuval etiketi · C-0042')).toBeTruthy();
  expect(screen.getAllByText('Çuval Yazıcı').length).toBeGreaterThan(0);
  expect(screen.getByText(/· Yazıcıya bağlanılamadı/)).toBeTruthy();
  expect(screen.getByText('Hata')).toBeTruthy();
  onlineManager.setOnline(true);
  fireEvent.press(screen.getByText('Şimdi gönder'));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText('Bekleyen rapor yok')).toBeTruthy());
  expect(apiClient.post).toHaveBeenCalledWith('/print-jobs', expect.objectContaining({ errorCode: 'BT_BAGLANTI' }));
});
