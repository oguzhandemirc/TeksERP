// Bekçi: lisans bandı ChannelStrip kalıbında — bant yoksa HİÇ çizilmez (gözlem = sıfır fark),
// varsa dokunmayı yutmaz, mutlak biner, kanal şeridi varsa onun ALTINA oturur; ton rengi tonla.
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LicenseBannerView } from './LicenseBanner';
import { colors } from '../theme/tokens';
import type { LicenseBanner } from '../lib/license';

const metrics = { frame: { x: 0, y: 0, width: 1280, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

function renderBand(banner: LicenseBanner | null, channelLabel: string | null = null) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <LicenseBannerView banner={banner} channelLabel={channelLabel} />
    </SafeAreaProvider>,
  );
}

function flatStyle(node: { props: { style?: unknown } }) {
  return Object.assign({}, ...[node.props.style].flat(2).filter(Boolean));
}

describe('LicenseBannerView', () => {
  it('bant yoksa hiçbir şey çizmez', () => {
    renderBand(null);
    expect(screen.queryByTestId('lisans-bandi')).toBeNull();
  });

  it('bant durum çubuğu şeridinde; dokunmayı yutmaz; tehlike tonu', () => {
    renderBand({ metin: 'Lisans kısıtlı kipte', ton: 'tehlike' });
    const band = screen.getByTestId('lisans-bandi');
    expect(screen.getByText('Lisans kısıtlı kipte')).toBeTruthy();
    expect(band.props.pointerEvents).toBe('none');
    const style = flatStyle(band);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(0);
    expect(style.height).toBe(24);
    expect(style.backgroundColor).toBe(colors.dangerDark);
  });

  it('kanal şeridi varsa onun altına oturur (üst üste binmez)', () => {
    renderBand({ metin: 'Ödeme bekleniyor', ton: 'uyari' }, 'TEST FABRİKA');
    const style = flatStyle(screen.getByTestId('lisans-bandi'));
    expect(style.top).toBe(24);
    expect(style.backgroundColor).toBe(colors.warningDark);
  });
});
