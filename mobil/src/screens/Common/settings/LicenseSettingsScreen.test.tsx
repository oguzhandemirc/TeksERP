// Bekçi: Ayarlar → Lisans. QR okutma kartı YALNIZ `license:manage` taşıyana çizilir; okutulan
// yanıt backend'e AYNEN (kırpılmış) gider; lisans yanıtına benzemeyen QR sunucuya HİÇ gitmez.
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';
import LicenseSettingsScreen from './LicenseSettingsScreen';
import { renderWithPaper } from '../../../test/render';
import { useAuthStore } from '../../../store/authStore';
import { licenseService } from '../../../services/license.service';
import { signalScan } from '../../../services/scanFeedback';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => false, goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../../services/license.service', () => ({
  licenseService: { getStatus: jest.fn(), submitOfflineResponse: jest.fn(async () => undefined) },
}));
jest.mock('../../../hooks/useLicenseStatus', () => ({
  LICENSE_STATUS_KEY: ['license', 'durum'],
  useLicenseStatus: () => ({
    isLoading: false,
    data: {
      ayrinti: true,
      kip: 'gozlem',
      kademe: 'NORMAL',
      bant: null,
      ekSureKalanGun: null,
      kisitlamaKalanGun: null,
      guncellemeIzni: true,
      sinif: 'TEST',
      lisansNo: 'TKS-2026-0007',
      lisansSahibi: { musteri: 'Örnek Tekstil', tesis: 'Merkez' },
      surum: '2.12.0',
    },
  }),
}));
// Kamera yerine: görünürken "okut" düğmesi verilen metni onScan'e verir.
let mockScanText = '';
jest.mock('../../../components/BarcodeScannerModal', () => ({
  BarcodeScannerModal: ({ visible, onScan }: { visible: boolean; onScan: (t: string) => void }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return visible ? (
      <Pressable testID="sahte-okut" onPress={() => onScan(mockScanText)}>
        <Text>okut</Text>
      </Pressable>
    ) : null;
  },
}));

const submit = licenseService.submitOfflineResponse as jest.Mock;

function signInWith(permissions: string[]) {
  useAuthStore.setState({ user: { userId: 'u1', username: 'y', permissions } as never });
}

async function scan(text: string) {
  mockScanText = text;
  fireEvent.press(screen.getByTestId('lisans-qr-okut'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('sahte-okut'));
  });
}

beforeEach(() => {
  submit.mockClear();
  (Toast.show as jest.Mock).mockClear();
  (signalScan as jest.Mock).mockClear();
});

describe('LicenseSettingsScreen', () => {
  it('özet her girişliye görünür; yetkisize QR kartı çizilmez', () => {
    signInWith(['mobile:kk1']);
    renderWithPaper(<LicenseSettingsScreen />);
    expect(screen.getByText('TKS-2026-0007')).toBeTruthy();
    expect(screen.getByText('Örnek Tekstil · Merkez')).toBeTruthy();
    expect(screen.queryByTestId('lisans-cevrimdisi-karti')).toBeNull();
  });

  it('license:manage: okutulan yanıt kırpılıp backend\'e AYNEN gider, kabul sinyali', async () => {
    signInWith(['license:manage']);
    renderWithPaper(<LicenseSettingsScreen />);
    const b64 = Buffer.from(JSON.stringify({ v: 1, kira: 'a.b.c' }), 'utf8').toString('base64url');
    await scan(`  ${b64}\n`);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toBe(b64);
    expect(signalScan).toHaveBeenCalledWith('accept');
    expect((Toast.show as jest.Mock).mock.calls[0][0].text1).toBe('Lisans yanıtı kabul edildi');
  });

  it('lisans yanıtı olmayan QR sunucuya gitmez, ret sinyali', async () => {
    signInWith(['license:manage']);
    renderWithPaper(<LicenseSettingsScreen />);
    await scan('https://lisans.example.com/q#abc');
    expect(submit).not.toHaveBeenCalled();
    expect(signalScan).toHaveBeenCalledWith('reject');
    expect((Toast.show as jest.Mock).mock.calls[0][0].text1).toBe('Bu QR bir lisans yanıtı değil');
  });

  it('backend reddederse (imzasız/kurcalı) mesajı gösterir, ret sinyali', async () => {
    signInWith(['license:manage']);
    submit.mockRejectedValueOnce(new Error('Yanıt imzası doğrulanamadı.'));
    renderWithPaper(<LicenseSettingsScreen />);
    await scan('{"v":1,"kira":"sahte"}');
    expect(signalScan).toHaveBeenCalledWith('reject');
    const last = (Toast.show as jest.Mock).mock.calls.at(-1)?.[0];
    expect(last.text1).toBe('Lisans yanıtı kabul edilmedi');
    expect(last.text2).toBe('Yanıt imzası doğrulanamadı.');
  });
});
