// Ölçüm kartı (2026-11-10 kullanıcı kararı): yalnız MANUEL alanın kutusu; ikisi otomatikse kart yok. Kutu içi ⊗ yalnız
// dolu kutuda, basınca o kutu temizlenir. Kip kombinasyonları saf `measureVisibility` ile.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburMeasureCard, { showClearIcon } from './TamburMeasureCard';
import { measureVisibility } from './cutReadings';

const len = (value: string, onClear = jest.fn()) => ({ value, onChange: jest.fn(), onClear, placeholder: 'kalanı kes' });
const kg = (value: string, onChange = jest.fn()) => ({ value, onChange, required: false });

describe('measureVisibility — kip kombinasyonları', () => {
  it('M/M iki kutu · M/O yalnız metre · O/M yalnız kg · O/O kart yok', () => {
    expect(measureVisibility('manual', 'manual', true)).toEqual({ meterBox: true, kgBox: true, card: true });
    expect(measureVisibility('manual', 'auto', true)).toEqual({ meterBox: true, kgBox: false, card: true });
    expect(measureVisibility('auto', 'manual', true)).toEqual({ meterBox: false, kgBox: true, card: true });
    expect(measureVisibility('auto', 'auto', true)).toEqual({ meterBox: false, kgBox: false, card: false });
  });
  it('kg alanı yoksa kg kutusu hiç yok; metre otomatikse kart da yok', () => {
    expect(measureVisibility('manual', 'manual', false)).toEqual({ meterBox: true, kgBox: false, card: true });
    expect(measureVisibility('auto', 'manual', false).card).toBe(false);
  });
});

describe('TamburMeasureCard', () => {
  it('manuel + dolu → ⊗ görünür; basınca o kutu temizlenir', () => {
    const onClear = jest.fn();
    const onKg = jest.fn();
    const r = renderWithPaper(<TamburMeasureCard length={len('50', onClear)} kg={kg('12,5', onKg)} />);
    fireEvent.press(r.getByTestId('tambur-olcum-metre-temizle'));
    expect(onClear).toHaveBeenCalled();
    fireEvent.press(r.getByTestId('tambur-tartim-kg-temizle'));
    expect(onKg).toHaveBeenCalledWith('');
  });

  it('boş kutuda ⊗ yok; otomatik alanın kutusu (ve ⊗) hiç çizilmez', () => {
    const r = renderWithPaper(<TamburMeasureCard length={len('')} kg={null} />);
    expect(r.queryByTestId('tambur-olcum-metre-temizle')).toBeNull();
    expect(r.queryByTestId('tambur-tartim-kg')).toBeNull();
    expect(r.queryByTestId('tambur-tartim-kg-temizle')).toBeNull();
    expect(r.queryByText(/Manuel giriş/)).toBeNull();
    expect(showClearIcon('  ')).toBe(false);
  });
});
