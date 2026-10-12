// B6 — tablet şeridi (LicenseBanner kalıbı): duyuru yoksa HİÇ çizilmez; uyarı/kesinti metni; dokunmayı yutmaz;
// mutlak biner; lisans bandı varsa onun ALTINA oturur (üst üste binmez).
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ServerOutageStripView } from './ServerOutageStrip';
import { colors } from '../theme/tokens';
import { OUTAGE_TEXT_ONGOING, outageStrip } from '../lib/sunucu-kesintisi';

const metrics = { frame: { x: 0, y: 0, width: 1280, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };
const T0 = 1_000_000;
const target = { atMs: T0 + 5 * 60_000, ongoing: false };

function renderStrip(unreachable: boolean, licenseBand = false, channelLabel: string | null = null, t: typeof target | null = target) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ServerOutageStripView strip={outageStrip(t, T0, unreachable)} channelLabel={channelLabel} licenseBand={licenseBand} />
    </SafeAreaProvider>,
  );
}

function flatStyle(node: { props: { style?: unknown } }) {
  return Object.assign({}, ...[node.props.style].flat(2).filter(Boolean));
}

describe('ServerOutageStripView', () => {
  it('duyuru yoksa hiçbir şey çizmez', () => {
    renderStrip(false, false, null, null);
    expect(screen.queryByTestId('sunucu-kesinti-seridi')).toBeNull();
  });

  it('5 dk kala uyarı: metin, dokunmayı yutmaz, uyarı tonu, durum çubuğu şeridinde', () => {
    renderStrip(false);
    const band = screen.getByTestId('sunucu-kesinti-seridi');
    expect(screen.getByText('Sunucu 5 dk sonra yaklaşık 1 dk güncellenecek — kaydedilmemiş işinizi kaydedin')).toBeTruthy();
    expect(band.props.pointerEvents).toBe('none');
    const style = flatStyle(band);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(0);
    expect(style.backgroundColor).toBe(colors.warningDark);
  });

  it("kesintide 'Sunucu güncelleniyor, yeniden bağlanıyor…' (bilgi tonu)", () => {
    renderStrip(true);
    expect(screen.getByText(OUTAGE_TEXT_ONGOING)).toBeTruthy();
    expect(flatStyle(screen.getByTestId('sunucu-kesinti-seridi')).backgroundColor).toBe(colors.infoDark);
  });

  it('lisans bandı varsa onun altına oturur (kanal şeridi + lisans bandı + kesinti)', () => {
    renderStrip(false, true, 'TEST FABRİKA');
    const style = flatStyle(screen.getByTestId('sunucu-kesinti-seridi'));
    expect(style.top).toBe(24 + 22);
    expect(style.height).toBe(22);
  });
});
