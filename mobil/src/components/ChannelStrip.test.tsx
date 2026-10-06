// Bekçi: test/demo kurulumunun görünür işareti — üretimde HİÇ çizilmez, işaretliyken dokunmayı yutmaz.
// Tek ortak paket O8: etiket lisans SINIFINDAN (TEST/DEMO); derleme etiket taşımaz.
// NEGATİF SONDA (ölçüldü): useChannelLabel lisans durumunu okumayınca §2 KIRMIZI; LICENSE_CLASS_LABELS'a
// URETIM eklenince §3 KIRMIZI.
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChannelStrip from './ChannelStrip';
import { LICENSE_STATUS_KEY } from '../hooks/useLicenseStatus';
import type { LicenseClass, LicenseStatusResponse } from '../lib/license';

const metrics = { frame: { x: 0, y: 0, width: 1280, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

function durum(sinif: LicenseClass | null): LicenseStatusResponse {
  return {
    ayrinti: true, kip: 'zorla', kademe: 'NORMAL', bant: null, ekSureKalanGun: null, kisitlamaKalanGun: null,
    guncellemeIzni: true, sinif, lisansNo: 'L-1', lisansSahibi: null, surum: '2.0.0',
  };
}

function renderStrip(lisans?: LicenseStatusResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (lisans) qc.setQueryData(LICENSE_STATUS_KEY, lisans);
  return render(
    <QueryClientProvider client={qc}>
      <SafeAreaProvider initialMetrics={metrics}>
        <ChannelStrip />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

describe('ChannelStrip', () => {
  it('§1 üretim kanalında (etiket yok, lisans yok) hiçbir şey çizmez', () => {
    renderStrip();
    expect(screen.queryByTestId('kanal-seridi')).toBeNull();
  });

  it('§2 TEST / DEMO lisansı şeridi durum çubuğuna çizer, dokunmayı yutmaz', () => {
    renderStrip(durum('TEST'));
    expect(screen.getByText('TEST KURULUMU')).toBeTruthy();
    const strip = screen.getByTestId('kanal-seridi');
    expect(strip.props.pointerEvents).toBe('none');
    const style = Object.assign({}, ...[strip.props.style].flat(2).filter(Boolean));
    expect(style.position).toBe('absolute');
    expect(style.height).toBe(24);
    screen.unmount();
    renderStrip(durum('DEMO'));
    expect(screen.getByText('DEMO KURULUMU')).toBeTruthy();
  });

  it('§3 üretim lisansı / sınıfsız / ayrıntısız yanıt → çizilmez (adnansahin görünümü)', () => {
    for (const l of [durum('URETIM'), durum(null), { ayrinti: false } as const]) {
      renderStrip(l);
      expect(screen.queryByTestId('kanal-seridi')).toBeNull();
      screen.unmount();
    }
  });
});
