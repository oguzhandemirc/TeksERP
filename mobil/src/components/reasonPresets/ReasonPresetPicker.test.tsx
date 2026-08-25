/**
 * BEKÇİ — hazır sebep seçici sözleşmesi (2026-08-25).
 *
 * Desen 2026-08-19 fire ekranından geliyor: serbest metin ÜSTTE, chip'ler altında.
 * Üç yerde elle kopyalanmıştı; buraya alındı. Kilitlenen davranışlar:
 *   • yazmaya başlamak "Diğer"i KENDİLİĞİNDEN seçer (operatör iki hamle yapmasın),
 *   • chip'e dokunmak serbest metni TEMİZLER (iki dil aynı anda okunmaz),
 *   • `optional` iken seçili chip'e tekrar dokunmak seçimi KALDIRIR,
 *   • kod UYDURULMAZ.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const presets = [
  { code: 'TON_TUTMADI', label: 'Ton tutmadı', requiresText: false },
  { code: 'LEKE', label: 'Leke / kir', requiresText: false },
  { code: 'DIGER', label: 'Diğer', requiresText: true },
];

jest.mock('../../hooks/useReasonPresets', () => ({
  useReasonPresets: () => ({ presets, isFallback: false }),
}));

import ReasonPresetPicker from './ReasonPresetPicker';

function setup(value = { code: null as string | null, text: '' }) {
  const onChange = jest.fn();
  const utils = render(
    <ReasonPresetPicker kind="WORK_ORDER_REWORK" value={value} onChange={onChange} optional />,
  );
  return { ...utils, onChange };
}

describe('ReasonPresetPicker', () => {
  it('chip listesi çizilir, "Diğer" chip OLARAK gösterilmez (o serbest metnin kendisi)', () => {
    const { getByText, queryByText } = setup();
    expect(getByText('Ton tutmadı')).toBeTruthy();
    expect(getByText('Leke / kir')).toBeTruthy();
    expect(queryByText('Diğer')).toBeNull();
  });

  it('chip seçimi kod döner', () => {
    const { getByText, onChange } = setup();
    fireEvent.press(getByText('Ton tutmadı'));
    expect(onChange).toHaveBeenCalledWith({ code: 'TON_TUTMADI', text: '' });
  });

  it('yazmaya başlamak "Diğer"i kendiliğinden seçer', () => {
    const { getByPlaceholderText, onChange } = setup();
    fireEvent.changeText(getByPlaceholderText(/Kendin yaz/), 'ton fazla açık');
    expect(onChange).toHaveBeenCalledWith({ code: 'DIGER', text: 'ton fazla açık' });
  });

  it('metni boşaltmak seçimi geri alır (kod uydurulmaz)', () => {
    const { getByPlaceholderText, onChange } = setup({ code: 'DIGER', text: 'x' });
    fireEvent.changeText(getByPlaceholderText(/Kendin yaz/), '');
    expect(onChange).toHaveBeenCalledWith({ code: null, text: '' });
  });

  it('chip seçimi serbest metni TEMİZLER', () => {
    const { getByText, onChange } = setup({ code: 'DIGER', text: 'elle yazılmış' });
    fireEvent.press(getByText('Leke / kir'));
    expect(onChange).toHaveBeenCalledWith({ code: 'LEKE', text: '' });
  });

  it('optional: seçili chip\'e tekrar dokunmak seçimi kaldırır', () => {
    const { getByText, onChange } = setup({ code: 'LEKE', text: '' });
    fireEvent.press(getByText('Leke / kir'));
    expect(onChange).toHaveBeenCalledWith({ code: null, text: '' });
  });
});
