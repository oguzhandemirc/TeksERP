// İE düzeltme kartları alt çubuğu (Kartı Yeniden Bas · Renk/En/Kat · Top Çıkar · Parti Ekle · Gramaj · Hedef): Vazgeç en solda dolu kırmızı,
// birincil sağda; 8dp köşe (hap değil), ≥56dp yükseklik.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Provider as PaperProvider } from 'react-native-paper';
import { Footer } from './fixSheetParts';
import { colors } from '../../../theme';

const flat = (style: unknown) => Object.assign({}, ...[style].flat(5).filter(Boolean));

describe('İE düzeltme alt çubuğu (Footer)', () => {
  it('⭐ Vazgeç ilk (sol), dolu kırmızı; Yenile ve Bas ikinci (sağ) birincil; 8dp köşe, 56dp', () => {
    const onCancel = jest.fn();
    const onSave = jest.fn();
    render(
      <PaperProvider>
        <Footer onCancel={onCancel} onSave={onSave} busy={false} disabled={false} label="Yenile ve Bas" />
      </PaperProvider>,
    );
    const [cancel, save] = screen.UNSAFE_getAllByType(Button);
    expect(cancel.props.testID).toBe('ie-duzelt-vazgec');
    expect(cancel.props.mode).toBe('contained');
    expect(cancel.props.buttonColor).toBe(colors.dangerDark);
    expect(flat(cancel.props.style).marginRight).toBe('auto');
    expect(save.props.testID).toBe('ie-duzelt-kaydet');
    expect(save.props.mode).toBe('contained');
    for (const b of [cancel, save]) {
      expect(flat(b.props.style).borderRadius).toBeLessThanOrEqual(8);
      expect(flat(b.props.contentStyle).minHeight).toBeGreaterThanOrEqual(56);
    }
    fireEvent.press(screen.getByText('Vazgeç'));
    fireEvent.press(screen.getByText('Yenile ve Bas'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
