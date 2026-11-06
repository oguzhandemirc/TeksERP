// =============================================================================
// Numpad emniyet ağı + Kurşun yerleşimi (2026-11-06 saha: tablette "Hata metresi"
// alanına dokununca HİÇBİR klavye açılmıyordu — sol kolondaki host ~40 dp'ye eziliyordu)
// =============================================================================
//   §1 host ölçülmeden / yeterince büyükken bugünkü davranış: sistem klavyesi kapalı,
//      dokunuş özel numpad'i hedefler
//   §2 host eşiğin altına ezilirse NumpadInput sistem klavyesine (decimal-pad) düşer
//   §3 ezik host yeniden büyürse özel numpad'e döner
//   §4 Kurşun: NumpadHost sağ kolonda (top listesinin altında), sol kolonda değil
// Negatif sonda: NumpadInput'ta `|| numpad.hostTooSmall` kaldırılınca §2 kırmızı;
// Kurşun'da host sol kolona geri konunca §4 kırmızı.
import React, { useState } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../test/render';
import NumpadInput from './NumpadInput';
import { NUMPAD_HOST_MIN_HEIGHT, NumpadHost, NumpadProvider } from './NumpadProvider';

function Harness() {
  const [v, setV] = useState('');
  return (
    <NumpadProvider>
      <NumpadInput testID="metre" value={v} onChangeText={setV} numpadLabel="Hata metresi" />
      <NumpadHost fill />
    </NumpadProvider>
  );
}

function layout(height: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width: 400, height } } };
}

describe('NumpadHost ölçüsü → NumpadInput klavye seçimi', () => {
  it('§1 ölçülmeden ve büyük host: özel numpad (sistem klavyesi kapalı), dokunuş tuşlara yazar', () => {
    const r = renderWithPaper(<Harness />);
    expect(r.getByTestId('metre').props.showSoftInputOnFocus).toBe(false);
    fireEvent(r.getByTestId('numpad-host'), 'layout', layout(NUMPAD_HOST_MIN_HEIGHT + 100));
    expect(r.getByTestId('metre').props.showSoftInputOnFocus).toBe(false);
    fireEvent(r.getByTestId('metre'), 'focus');
    fireEvent.press(r.getByText('7'));
    expect(r.getByTestId('metre').props.value).toBe('7');
  });

  it('§2 ⭐ host eşiğin altında (ezik) → sistem klavyesi (decimal-pad), numpad hedefi açılmaz', () => {
    const r = renderWithPaper(<Harness />);
    fireEvent(r.getByTestId('numpad-host'), 'layout', layout(40));
    const input = r.getByTestId('metre');
    expect(input.props.showSoftInputOnFocus).not.toBe(false);
    expect(input.props.keyboardType).toBe('decimal-pad');
    fireEvent(input, 'focus');
    expect(r.queryByText('7')).toBeNull();
    expect(r.getByText(/tablet klavyesi açılır/)).toBeTruthy();
    fireEvent.changeText(r.getByTestId('metre'), '12,5');
    expect(r.getByTestId('metre').props.value).toBe('12.5');
  });

  it('§3 ezik host yeniden büyürse özel numpad geri gelir', () => {
    const r = renderWithPaper(<Harness />);
    fireEvent(r.getByTestId('numpad-host'), 'layout', layout(40));
    fireEvent(r.getByTestId('numpad-host'), 'layout', layout(NUMPAD_HOST_MIN_HEIGHT));
    expect(r.getByTestId('metre').props.showSoftInputOnFocus).toBe(false);
    expect(r.getByText('7')).toBeTruthy();
  });
});

describe('Kurşun tablet yerleşimi', () => {
  it('§4 ⭐ NumpadHost sağ kolonun içinde (renderRightContent altında), sol kolonda yok', () => {
    // Ekran 2800+ satır ve onlarca servis ister; render yerine kaynakta yer ölçülür.
    const src = jest
      .requireActual<typeof import('fs')>('fs')
      .readFileSync(require.resolve('../screens/Modules/KursunQc/KursunQcScreen.tsx'), 'utf8');
    const hosts = src.match(/<NumpadHost\b/g) ?? [];
    expect(hosts).toHaveLength(1);
    const rightStart = src.indexOf('<View style={styles.rightCol}>');
    expect(rightStart).toBeGreaterThan(-1);
    const rightBlock = src.slice(rightStart, src.indexOf('</View>', rightStart));
    expect(rightBlock).toMatch(/renderRightContent\(\)[\s\S]*<NumpadHost\b/);
    // Sağda sabit iri tuşlar: fill (kalan alana esneme) değil.
    expect(rightBlock).not.toMatch(/<NumpadHost[^>]*\bfill\b/);
  });
});
