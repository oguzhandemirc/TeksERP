// Bekçi: K5 tam ekranı — yalnız GİRİŞLİ kullanıcıda ve (sunucu DURDURULMUS dedi ∨ bir istek
// 403 LICENSE_SUSPENDED döndü) iken çizilir; gözlem kipinde DURDURULMUS asla çizdirmez;
// "Tekrar dene" sinyali düşürüp durumu tazeler; çıkışta sinyal temizlenir.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import LicenseSuspendedGate from './LicenseSuspendedGate';
import { useAuthStore } from '../../store/authStore';
import { useLicenseStore } from '../../store/licenseStore';
import type { LicenseStatusResponse } from '../../lib/license';

const mockStatus: { data: LicenseStatusResponse | undefined; refetch: jest.Mock } = {
  data: undefined,
  refetch: jest.fn(async () => undefined),
};
jest.mock('../../hooks/useLicenseStatus', () => ({ useLicenseStatus: () => mockStatus }));
jest.mock('../../offline/sessionSwitch', () => ({ performLogout: jest.fn(async () => ({ pendingCount: 0 })) }));
// Paper ikonu `@expo/vector-icons/MaterialCommunityIcons`i çeker; font yükleyicisi testte
// act dışı güncelleme basar — ikon yerine düz View yeter.
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});

function summary(kip: 'gozlem' | 'zorla', kademe: 'NORMAL' | 'DURDURULMUS'): LicenseStatusResponse {
  return {
    ayrinti: true,
    kip,
    kademe,
    bant: kademe === 'DURDURULMUS' ? { metin: 'Sözleşme askıda', ton: 'tehlike' } : null,
    ekSureKalanGun: null,
    kisitlamaKalanGun: null,
    guncellemeIzni: true,
    sinif: 'URETIM',
    lisansNo: 'TKS-2026-0001',
    lisansSahibi: null,
    surum: '2.12.0',
  };
}

function signIn(signed: boolean) {
  useAuthStore.setState({
    user: signed ? ({ userId: 'u1', username: 'op', permissions: [] } as never) : null,
  });
}

beforeEach(() => {
  mockStatus.data = undefined;
  mockStatus.refetch.mockClear();
  useLicenseStore.setState({ suspended: false, blockSeq: 0 });
  signIn(true);
});

describe('LicenseSuspendedGate', () => {
  it('normal durumda çizilmez', () => {
    mockStatus.data = summary('zorla', 'NORMAL');
    render(<LicenseSuspendedGate />);
    expect(screen.queryByTestId('lisans-k5-ekrani')).toBeNull();
  });

  it('gözlem kipinde DURDURULMUS gelse bile çizilmez (sıfır fark)', () => {
    mockStatus.data = summary('gozlem', 'DURDURULMUS');
    render(<LicenseSuspendedGate />);
    expect(screen.queryByTestId('lisans-k5-ekrani')).toBeNull();
  });

  it('sunucu zorlamada DURDURULMUS derse bandın mesajıyla çizilir', () => {
    mockStatus.data = summary('zorla', 'DURDURULMUS');
    render(<LicenseSuspendedGate />);
    expect(screen.getByTestId('lisans-k5-ekrani')).toBeTruthy();
    expect(screen.getByText('Sözleşme askıda')).toBeTruthy();
  });

  it('403 LICENSE_SUSPENDED sinyali tek başına çizer; Tekrar dene sinyali düşürüp tazeler', async () => {
    useLicenseStore.setState({ suspended: true });
    render(<LicenseSuspendedGate />);
    expect(screen.getByTestId('lisans-k5-ekrani')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('lisans-k5-tekrar'));
    });
    expect(mockStatus.refetch).toHaveBeenCalledTimes(1);
    expect(useLicenseStore.getState().suspended).toBe(false);
  });

  it('kullanıcı yoksa çizilmez (önbellekte K5 kalsa bile) ve sinyal temizlenir', () => {
    useLicenseStore.setState({ suspended: true });
    mockStatus.data = summary('zorla', 'DURDURULMUS');
    signIn(false);
    render(<LicenseSuspendedGate />);
    expect(screen.queryByTestId('lisans-k5-ekrani')).toBeNull();
    expect(useLicenseStore.getState().suspended).toBe(false);
  });
});
