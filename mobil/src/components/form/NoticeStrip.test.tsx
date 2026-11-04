// Bekçi: uyarı şeridi tona göre zemin alır; eylem düğmesi basılır.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NoticeStrip } from './NoticeStrip';
import { colors } from '../../theme';

describe('NoticeStrip', () => {
  it('metin + ton + eylem', () => {
    const onPress = jest.fn();
    render(<NoticeStrip tone="warn" text="Kat tipi tanımlı değil" action={{ label: 'Yenile', onPress, testID: 'a' }} testID="n" />);
    expect(screen.getByText('Kat tipi tanımlı değil')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('n').props.style).backgroundColor).toBe(colors.warningContainer);
    fireEvent.press(screen.getByTestId('a'));
    expect(onPress).toHaveBeenCalled();
  });
});
