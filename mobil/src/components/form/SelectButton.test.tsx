// Bekçi: boş seçici "seç" çağrısı (marka kenarı), dolu seçici değer + başlık; durumlar kenar rengini değiştirir.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SelectButton } from './SelectButton';
import { colors } from '../../theme';
import { DOC_HIGHLIGHT_BG } from '../DocHighlight';

const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

describe('SelectButton', () => {
  it('boş: label marka renkli kutuda, basınca onPress', () => {
    const onPress = jest.fn();
    render(<SelectButton label="Rota seç" onPress={onPress} testID="b" optional />);
    expect(screen.getByText('Rota seç')).toBeTruthy();
    expect(screen.getByText('isteğe bağlı')).toBeTruthy();
    expect(style('b').borderColor).toBe(colors.brand);
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalled();
  });
  it('dolu: caption + değer, label gizli', () => {
    render(<SelectButton label="Hedef kumaş seç" caption="Hedef kumaş" value="TÜL 300" hint="Belgede: X" onPress={() => {}} testID="b" />);
    expect(screen.getByText('TÜL 300')).toBeTruthy();
    expect(screen.getByText('Hedef kumaş')).toBeTruthy();
    expect(screen.getByText('Belgede: X')).toBeTruthy();
    expect(screen.queryByText('Hedef kumaş seç')).toBeNull();
    expect(style('b').borderColor).toBe(colors.borderStrong);
  });
  it('durumlar: fromDoc sarı, review uyarı, missing tehlike', () => {
    const { rerender } = render(<SelectButton label="x" value="v" state="fromDoc" onPress={() => {}} testID="b" />);
    expect(style('b').backgroundColor).toBe(DOC_HIGHLIGHT_BG);
    rerender(<SelectButton label="x" value="v" state="review" onPress={() => {}} testID="b" />);
    expect(style('b').borderColor).toBe(colors.warning);
    rerender(<SelectButton label="x" state="missing" onPress={() => {}} testID="b" />);
    expect(style('b').borderColor).toBe(colors.danger);
    expect(style('b').backgroundColor).toBe(colors.dangerContainer);
  });
  it('disabled basılamaz', () => {
    const onPress = jest.fn();
    render(<SelectButton label="x" disabled onPress={onPress} testID="b" />);
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('b')).toBeDisabled();
  });
});
