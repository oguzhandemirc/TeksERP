// Bekçi: sayı kutusu değeri yazar/okur, birimi gösterir, belge vurgusu ve türetilmiş not yerinde.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { CompactNumberField } from './CompactNumberField';
import { colors } from '../../theme';
import { DOC_HIGHLIGHT_BG } from '../DocHighlight';

const bg = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).backgroundColor;

describe('CompactNumberField', () => {
  it('değer + birim + değişim', () => {
    const onChange = jest.fn();
    render(<CompactNumberField label="En" unit="cm" value="280" onChangeText={onChange} testID="en" />);
    expect(screen.getByTestId('en').props.value).toBe('280');
    expect(screen.getByText('cm')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('en'), '300');
    expect(onChange).toHaveBeenCalledWith('300');
    expect(bg('en-kutu')).toBe(colors.surface);
  });
  it('fromDoc sarı, invalid tehlike, türetilmiş not', () => {
    const { rerender } = render(
      <CompactNumberField label="Metraj" unit="m" value="1" onChangeText={() => {}} fromDoc derivedNote="gelen metre" derivedTestID="d" testID="m" />,
    );
    expect(bg('m-kutu')).toBe(DOC_HIGHLIGHT_BG);
    expect(screen.getByTestId('d')).toHaveTextContent('↧ gelen metre');
    rerender(<CompactNumberField label="Metraj" unit="m" value="x" onChangeText={() => {}} invalid testID="m" />);
    expect(bg('m-kutu')).toBe(colors.dangerContainer);
    expect(screen.queryByTestId('d')).toBeNull();
  });
  it('odakta çerçeve ana renkte ve kalın; odak gidince eski hâl; grow → flex 1', () => {
    render(<CompactNumberField label="En" unit="cm" value="" onChangeText={() => {}} grow testID="en" />);
    const box = () => StyleSheet.flatten(screen.getByTestId('en-kutu').props.style);
    expect(box().flex).toBe(1);
    expect(box().borderColor).toBe(colors.borderStrong);
    fireEvent(screen.getByTestId('en'), 'focus');
    expect(box().borderColor).toBe(colors.brand);
    expect(box().borderWidth).toBe(2.5);
    fireEvent(screen.getByTestId('en'), 'blur');
    expect(box().borderColor).toBe(colors.borderStrong);
  });
});
