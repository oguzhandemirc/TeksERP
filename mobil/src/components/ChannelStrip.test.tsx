// Bekçi: hazırlık kanalının görünür işareti — üretimde HİÇ çizilmez, hazırlıkta dokunmayı yutmaz.
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChannelStrip from './ChannelStrip';

const metrics = { frame: { x: 0, y: 0, width: 1280, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

function renderStrip(config: { extra?: unknown } | null) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ChannelStrip config={config} />
    </SafeAreaProvider>,
  );
}

describe('ChannelStrip', () => {
  it('üretim kanalında (etiket yok) hiçbir şey çizmez', () => {
    renderStrip({});
    expect(screen.queryByTestId('kanal-seridi')).toBeNull();
  });

  it('hazırlık kanalında etiketi durum çubuğu şeridinde gösterir, dokunmayı yutmaz', () => {
    renderStrip({ extra: { gorunurEtiket: 'TEST FABRİKA' } });
    const strip = screen.getByTestId('kanal-seridi');
    expect(screen.getByText('TEST FABRİKA')).toBeTruthy();
    expect(strip.props.pointerEvents).toBe('none');
    const style = Object.assign({}, ...[strip.props.style].flat(2).filter(Boolean));
    expect(style.position).toBe('absolute');
    expect(style.height).toBe(24);
  });
});
