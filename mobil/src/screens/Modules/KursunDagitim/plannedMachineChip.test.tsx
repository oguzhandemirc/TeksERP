// Dağıtım ekranı plan makinesi çipi (Gülkesim 2026-11-02): yalnız öneri. Dokunulabilir çip öneri yokken
// "seç" der ve dokunuşu iletir; salt-okunur çip yalnız öneri varken çizilir.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { PlannedMachineChip } from './dagitimUi';

describe('PlannedMachineChip', () => {
  it('öneri adıyla görünür ve dokunuşu iletir', () => {
    const onPress = jest.fn();
    const r = renderWithPaper(<PlannedMachineChip name="Kurşun M2" onPress={onPress} />);
    expect(r.getByText('Plan: Kurşun M2')).toBeTruthy();
    fireEvent.press(r.getByTestId('planned-machine-chip'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('dokunulabilirken öneri yoksa "Plan makinesi seç"', () => {
    const r = renderWithPaper(<PlannedMachineChip name={null} onPress={jest.fn()} />);
    expect(r.getByText('Plan makinesi seç')).toBeTruthy();
  });
  it('salt-okunur ve öneri yoksa hiç çizilmez', () => {
    expect(renderWithPaper(<PlannedMachineChip name={null} />).queryByTestId('planned-machine-chip')).toBeNull();
  });
});
