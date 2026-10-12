// TruncatedText: ad tek satırda "…" ile kısalır; kısaldıysa basılı tutunca tam ad
// balonda; kısa adda balon yok; erişilebilirlik etiketi daima tam ad; satırın kendi
// tek dokunuşu korunur. Ölçü kopyasının satır sayısı testte elle verilir (jest'te
// yerleşim yok).
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { TouchableRipple } from 'react-native-paper';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { renderWithPaper } from '../test/render';
import { UZUN_AD, longPress, measureLines } from '../test/truncatedText';
import TruncatedText, { flattenTextParts, splitTruncatedStyle } from './TruncatedText';
import { computeBalloonLayout } from './truncatedTextLayout';

describe('TruncatedText', () => {
  it('tek satır + sondan kısaltma; erişilebilirlik etiketi tam ad', () => {
    expect(UZUN_AD.length).toBeGreaterThan(60);
    renderWithPaper(<TruncatedText testID="ad">{UZUN_AD}</TruncatedText>);
    const t = screen.getByTestId('ad');
    expect(t.props.numberOfLines).toBe(1);
    expect(t.props.ellipsizeMode).toBe('tail');
    expect(screen.getByLabelText(UZUN_AD)).toBe(t);
    // Ölçü kopyası erişilebilirlikten gizli: görünür sorgu tek düğüm bulur.
    expect(screen.getAllByText(UZUN_AD)).toHaveLength(1);
  });

  it('kısaldıysa uzun basınca tam ad balonda; balona dokununca kapanır', async () => {
    renderWithPaper(<TruncatedText testID="ad">{UZUN_AD}</TruncatedText>);
    await measureLines('ad', 3);
    expect(screen.queryByTestId('tam-ad-balonu')).toBeNull();
    longPress('ad');
    expect(screen.getByTestId('tam-ad-balonu')).toBeTruthy();
    expect(screen.getAllByText(UZUN_AD)).toHaveLength(2);
    fireEvent.press(screen.getByLabelText('Tam adı kapat'));
    expect(screen.queryByTestId('tam-ad-balonu')).toBeNull();
  });

  it('kısa adda (tek satıra sığan) balon YOK', async () => {
    renderWithPaper(<TruncatedText testID="ad">TZ-12</TruncatedText>);
    await measureLines('ad', 1);
    longPress('ad');
    expect(screen.queryByTestId('tam-ad-balonu')).toBeNull();
    expect(screen.getByTestId('ad').props.accessibilityActions).toBeUndefined();
  });

  it('ölçü gelmeden (yerleşim yok) balon açılmaz — varsayılan kısalmamış', () => {
    renderWithPaper(<TruncatedText testID="ad">{UZUN_AD}</TruncatedText>);
    longPress('ad');
    expect(screen.queryByTestId('tam-ad-balonu')).toBeNull();
  });

  it('satırın tek dokunuşu korunur (balon açılmaz, satır onPress çalışır)', async () => {
    const onPress = jest.fn();
    renderWithPaper(
      <TouchableRipple onPress={onPress}>
        <TruncatedText testID="ad">{UZUN_AD}</TruncatedText>
      </TouchableRipple>,
    );
    await measureLines('ad', 2);
    fireEvent.press(screen.getByTestId('ad'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('tam-ad-balonu')).toBeNull();
    // Basılabilir satırda tek dokunuş jest'i hiç kurulmaz.
    expect(() => getByGestureTestId('ad-dokunus')).toThrow();
  });

  it('revealOnTap: salt gösterge yüzeyde tek dokunuş da balon açar', async () => {
    renderWithPaper(<TruncatedText testID="cip" revealOnTap>{UZUN_AD}</TruncatedText>);
    await measureLines('cip', 2);
    act(() => {
      fireGestureHandler(getByGestureTestId('cip-dokunus'), [
        { state: State.BEGAN, absoluteX: 10, absoluteY: 10 },
        { state: State.ACTIVE, absoluteX: 10, absoluteY: 10 },
        { state: State.END, absoluteX: 10, absoluteY: 10 },
      ]);
    });
    expect(screen.getByTestId('tam-ad-balonu')).toBeTruthy();
  });

  it('erişilebilirlik eylemi (longpress) balonu açar', async () => {
    renderWithPaper(<TruncatedText testID="ad">{UZUN_AD}</TruncatedText>);
    await measureLines('ad', 2);
    const t = screen.getByTestId('ad');
    expect(t.props.accessibilityActions).toEqual([{ name: 'longpress', label: 'Tam adı göster' }]);
    act(() => {
      t.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
    });
    expect(screen.getByTestId('tam-ad-balonu')).toBeTruthy();
  });

  it('parçalı çocuk tek metne birleşir; yerleşim stili sarmalayıcıya gider', () => {
    expect(flattenTextParts(['Kumaş', ' · ', null, false, 'Kırmızı', 3])).toBe('Kumaş · Kırmızı3');
    const { box, text } = splitTruncatedStyle([{ flex: 1, marginTop: 4, fontSize: 16, color: 'red' }]);
    expect(box).toEqual({ flex: 1, marginTop: 4 });
    expect(text).toEqual({ fontSize: 16, color: 'red' });
  });
});

describe('computeBalloonLayout', () => {
  const vp = { width: 1920, height: 1200 };

  it('yer varsa parmağın ÜSTÜNDE, noktaya ortalı', () => {
    const l = computeBalloonLayout({ x: 960, y: 600 }, vp);
    expect(l.above).toBe(true);
    expect(l.bottom).toBe(1200 - (600 - 36));
    expect(l.top).toBeUndefined();
    expect(l.left + l.width / 2).toBe(960);
  });

  it('üstte yer yoksa altta; kenarda ekran içine kırpılır', () => {
    const l = computeBalloonLayout({ x: 5, y: 40 }, vp);
    expect(l.above).toBe(false);
    expect(l.top).toBe(76);
    expect(l.left).toBe(8);
    const r = computeBalloonLayout({ x: 1915, y: 600 }, vp);
    expect(r.left + r.width).toBe(1920 - 8);
  });

  it('dar telefonda genişlik ekran − kenar payı; çöp değer güvenli', () => {
    const l = computeBalloonLayout({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, { width: 360, height: 800 });
    expect(l.width).toBe(344);
    expect(l.left).toBe(8);
    expect(Number.isFinite(l.maxHeight)).toBe(true);
  });
});
