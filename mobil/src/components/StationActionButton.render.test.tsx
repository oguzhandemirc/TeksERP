// =============================================================================
// StationActionButton — `size="xl"` 112dp (KK1 Kaydet ölçüsü; S3 Devere SAR/TAK)
// =============================================================================
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../test/render';
import StationActionButton, { XL_BAR_HEIGHT } from './StationActionButton';

function heightOf(node: { props: { style?: unknown } }): number | undefined {
  return (StyleSheet.flatten(node.props.style as never) as { height?: number } | undefined)?.height;
}

describe('StationActionButton boyut', () => {
  it('size="xl" → 112dp; varsayılan 60dp; basış onPress çağırır', async () => {
    const onPress = jest.fn();
    const r = renderWithPaper(
      <>
        <StationActionButton label="TAK" icon="link" onPress={onPress} size="xl" testID="xl" />
        <StationActionButton label="Kes" icon="content-cut" onPress={jest.fn()} testID="md" />
      </>
    );
    await act(async () => {});
    expect(XL_BAR_HEIGHT).toBe(112);
    expect(heightOf(r.getByTestId('xl'))).toBe(112);
    expect(heightOf(r.getByTestId('md'))).toBe(60);
    fireEvent.press(r.getByTestId('xl'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
