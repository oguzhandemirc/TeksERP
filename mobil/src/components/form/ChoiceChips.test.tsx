// Bekçi: seçili çip indigo dolgu + accessibilityState.selected; çoklu seçim aç/kapa; "sonra" kesik çip null seçer.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ChoiceChips } from './ChoiceChips';
import { colors } from '../../theme';

const bg = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).backgroundColor;
const opts = [{ value: null, label: 'Sonra seçilsin', dashed: true }, { value: 'K1', label: '1' }, { value: 'K2', label: '2' }];

describe('ChoiceChips', () => {
  it('tek seçim: seçili indigo, seçisiz beyaz; basınca değer', () => {
    const onChange = jest.fn();
    render(<ChoiceChips options={opts} value="K1" onChange={onChange} size="square" testID="m" />);
    expect(screen.getByTestId('m-K1').props.accessibilityState).toMatchObject({ selected: true });
    expect(bg('m-K1')).toBe(colors.choice.onBg);
    expect(bg('m-K2')).toBe(colors.choice.offBg);
    fireEvent.press(screen.getByTestId('m-yok'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
  it('"sonra" seçiliyken koyu gri dolgu', () => {
    render(<ChoiceChips options={opts} value={null} onChange={() => {}} testID="m" />);
    expect(bg('m-yok')).toBe(colors.choice.laterOnBg);
    expect(screen.getByTestId('m-K1').props.accessibilityState).toMatchObject({ selected: false });
  });
  it('çoklu seçim aç/kapa + özel testID', () => {
    const onChange = jest.fn();
    const o = [{ value: 'a', label: 'A', testID: 'oz-a' }, { value: 'b', label: 'B' }];
    render(<ChoiceChips multi options={o} value={['a']} onChange={onChange} testID="oz" />);
    fireEvent.press(screen.getByTestId('oz-a'));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.press(screen.getByTestId('oz-b'));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  });
  it('disabled: basılmaz ve devre dışı görünür', () => {
    const onChange = jest.fn();
    render(<ChoiceChips options={opts} value="K1" onChange={onChange} disabled testID="m" />);
    expect(screen.getByTestId('m-K2')).toBeDisabled();
    fireEvent.press(screen.getByTestId('m-K2'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
