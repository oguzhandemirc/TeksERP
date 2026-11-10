// Ortak birimli giriş (Metre · Kg · En; tur-4): birim kutunun içinde görünür, ⊗ yalnız dolu + manuel kutuda,
// erişilebilirlik etiketi birimin uzun adını taşır.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../test/render';
import UnitInput, { showClearIcon } from './UnitInput';

function box(over: Partial<React.ComponentProps<typeof UnitInput>> = {}) {
  const onClear = jest.fn();
  const r = renderWithPaper(
    <UnitInput value="50" onChange={jest.fn()} unit="m" unitName="metre" label="Kesim uzunluğu" placeholder="kalanı kes" onClear={onClear} testID="t" {...over} />,
  );
  return { r, onClear };
}

describe('UnitInput', () => {
  it('birim metni kutunun içinde görünür; ayrı başlık yok', () => {
    const { r } = box({ unit: 'cm', unitName: 'santimetre', label: 'En' });
    expect(r.getByText('cm')).toBeTruthy();
    expect(r.queryByText('En')).toBeNull();
  });

  it('⊗ dolu + manuel kutuda görünür, basınca temizler', () => {
    const { r, onClear } = box();
    fireEvent.press(r.getByTestId('t-temizle'));
    expect(onClear).toHaveBeenCalled();
  });

  it('⊗ boş kutuda ve otomatik kipte yok', () => {
    expect(box({ value: '' }).r.queryByTestId('t-temizle')).toBeNull();
    expect(box({ manual: false }).r.queryByTestId('t-temizle')).toBeNull();
    expect(showClearIcon('  ')).toBe(false);
    expect(showClearIcon('5', false)).toBe(false);
    expect(showClearIcon('5')).toBe(true);
  });

  it('erişilebilirlik etiketi birimi içerir', () => {
    const { r } = box();
    expect(r.getByLabelText('Kesim uzunluğu, metre')).toBeTruthy();
    const kg = box({ unit: 'kg', unitName: 'kilogram', label: 'Tartım', required: true, testID: 'k' }).r;
    expect(kg.getByLabelText('Tartım, kilogram, zorunlu')).toBeTruthy();
  });
});
