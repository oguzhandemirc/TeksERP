// Seçenek satırı kalıbı (her genişlikte): soru KUTU DEĞİL, üstte küçük soluk başlık; seçenekler eşit genişlikte (flex 1, basis 0)
// tek sırada, ≥56dp; seçili dolu + ✓, seçilmeyen çerçeveli; ikonlu seçenekte ikon solda. 4'ten fazla seçenek ızgaraya sarar.
// Negatif sonda: ChoiceRow'da `fill` kaldırılınca eşit genişlik vakası kırmızı.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { ChoiceRow } from './ChoiceRow';
import { colors } from '../../theme';

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as Record<string, unknown>;
const draw = (n: number, value: string | null = 'a', icons = false) => {
  const onChange = jest.fn();
  const options = Array.from({ length: n }, (_, i) => ({ value: String.fromCharCode(97 + i), label: `Seçenek ${i + 1}`, icon: icons ? ('layers-triple-outline' as const) : undefined }));
  render(<PaperProvider><ChoiceRow label="Kumaş nasıl geldi?" rowTestID="satir" options={options} value={value} onChange={onChange} testID="sec" /></PaperProvider>);
  return onChange;
};

describe('ChoiceRow', () => {
  it('⭐ başlık küçük ve soluk metin, kutu değil (zemin/kenar yok); seçeneklerin ÜSTÜNDE', () => {
    draw(2);
    const cap = flat('satir-baslik');
    expect(cap.backgroundColor).toBeUndefined();
    expect(cap.borderWidth).toBeUndefined();
    expect(cap.flexDirection).toBe('row');
    const label = within(screen.getByTestId('satir-baslik')).getByText('Kumaş nasıl geldi?');
    expect(StyleSheet.flatten(label.props.style).fontSize).toBeLessThanOrEqual(13);
    expect(StyleSheet.flatten(label.props.style).color).toBe(colors.textSecondary);
    // Satır dikey: başlık ilk çocuk, seçenekler sonra.
    expect(flat('satir').flexDirection).toBeUndefined();
  });

  it('⭐ iki seçenek eşit genişlik (flexGrow 1, basis 0), tek sıra, ≥56dp; seçili dolu, seçilmeyen çerçeveli', () => {
    draw(2, 'a', true);
    for (const id of ['sec-a', 'sec-b']) {
      const s = flat(id);
      expect(s.flexGrow).toBe(1);
      expect(s.flexBasis).toBe(0);
      expect(s.minHeight).toBeGreaterThanOrEqual(56);
    }
    expect(flat('sec').flexWrap).toBe('nowrap');
    expect(flat('sec-a').backgroundColor).toBe(colors.choice.onBg);
    expect(flat('sec-b').backgroundColor).toBe(colors.choice.offBg);
    expect(flat('sec-b').borderColor).toBe(colors.choice.offBorder);
    expect(screen.getByTestId('sec-a').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('üç seçenek (gramaj) de tek sıra eşit; basınca değer', () => {
    const onChange = draw(3, null);
    expect(flat('sec').flexWrap).toBe('nowrap');
    expect(flat('sec-c').flexBasis).toBe(0);
    fireEvent.press(screen.getByTestId('sec-c'));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('beşten çok seçenek düzgün ızgaraya sarar (sabit sütun payı)', () => {
    draw(6);
    expect(flat('sec').flexWrap).toBe('wrap');
    expect(flat('sec-f').flexBasis).toBe('31%');
  });
});
