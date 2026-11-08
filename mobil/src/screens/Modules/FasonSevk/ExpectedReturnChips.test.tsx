// Negatif sonda (2026-11-08): `expectedReturnPayload` null'da '' döndürünce 1. test; çip `onChange(c.days)` yerine
// sabit 7 yollayınca 2. test kırmızı. Geri alındı.
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import ExpectedReturnChips, { expectedReturnPayload } from './ExpectedReturnChips';
import { renderWithPaper } from '../../../test/render';

describe('ExpectedReturnChips', () => {
  it('Varsayılan alanı göndermez (eski APK ile aynı); gün seçimi fabrika günü anahtarı', () => {
    expect(expectedReturnPayload(null, '2026-11-08')).toBeUndefined();
    expect(expectedReturnPayload(5, '2026-11-08')).toBe('2026-11-13');
    expect(expectedReturnPayload(3, '2026-12-30')).toBe('2027-01-02');
  });

  it('çipe dokununca seçilen gün sayısını bildirir, Varsayılan null döner', async () => {
    const onChange = jest.fn();
    renderWithPaper(<ExpectedReturnChips days={5} onChange={onChange} />);
    await act(async () => {});
    fireEvent.press(screen.getByText('10 gün'));
    fireEvent.press(screen.getByText('Varsayılan'));
    expect(onChange.mock.calls).toEqual([[10], [null]]);
  });
});
