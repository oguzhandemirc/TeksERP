// Bekçi: etiket adedi seçicisi — büyük "– N +", sınırda ilgili düğme kilitli.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { LabelCopiesStepper } from './LabelCopiesStepper';

function setup(count: number) {
  const onInc = jest.fn();
  const onDec = jest.fn();
  const utils = render(
    <PaperProvider>
      <LabelCopiesStepper count={count} onInc={onInc} onDec={onDec} height={112} />
    </PaperProvider>,
  );
  return { ...utils, onInc, onDec };
}

describe('LabelCopiesStepper', () => {
  it('adedi gösterir, + ve – çağırır', () => {
    const { getByTestId, onInc, onDec } = setup(3);
    expect(getByTestId('label-copies-count').props.children).toBe(3);
    fireEvent.press(getByTestId('label-copies-inc'));
    fireEvent.press(getByTestId('label-copies-dec'));
    expect(onInc).toHaveBeenCalledTimes(1);
    expect(onDec).toHaveBeenCalledTimes(1);
  });

  it('1de – , 5te + basmaz', () => {
    const low = setup(1);
    fireEvent.press(low.getByTestId('label-copies-dec'));
    expect(low.onDec).not.toHaveBeenCalled();
    low.unmount();
    const high = setup(5);
    fireEvent.press(high.getByTestId('label-copies-inc'));
    expect(high.onInc).not.toHaveBeenCalled();
  });
});
