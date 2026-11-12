// Kat tipi çipleri gramajla aynı varsayılan işaretini taşır (★ + "varsayılan" adı) — tek kaynak `defaultChoiceText`.
import React from 'react';
import { renderWithPaper } from '../../../../test/render';
import { FoldField } from './DocRowMeasures';

describe('FoldField — varsayılan kat ★', () => {
  it('⭐ isDefault değer ★ ile, diğeri düz çizilir', () => {
    const s = renderWithPaper(
      <FoldField values={[{ code: '2-KAT', name: '2 Kat' }, { code: '4-KAT', name: '4 Kat', isDefault: true }]} value="4-KAT" locked={false} onChange={jest.fn()} />,
    );
    expect(s.getByTestId('ie-form-kat-4-KAT')).toHaveTextContent(/4 Kat ★/);
    expect(s.getByTestId('ie-form-kat-4-KAT')).toHaveProp('accessibilityLabel', '4 Kat, varsayılan');
    expect(s.getByTestId('ie-form-kat-2-KAT')).not.toHaveTextContent(/★/);
  });
});
