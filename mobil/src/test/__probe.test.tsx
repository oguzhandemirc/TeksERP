import React, { useState } from 'react';
import { View, TextInput } from 'react-native';
import { fireEvent, screen, act } from '@testing-library/react-native';
import AppModal from '../components/AppModal';
import { renderWithPaper } from './render';

function Spy(props: any) {
  return <TextInput testID="inp" {...props} />;
}

function OutsideState() {
  const [v, setV] = useState('ABC');
  return (
    <AppModal visible onDismiss={() => {}}>
      <View><Spy value={v} onChangeText={setV} /></View>
    </AppModal>
  );
}

function Inner() {
  const [v, setV] = useState('ABC');
  return <Spy value={v} onChangeText={setV} />;
}
function InsideState() {
  return (
    <AppModal visible onDismiss={() => {}}>
      <View><Inner /></View>
    </AppModal>
  );
}

describe('probe2', () => {
  it('outside — sync?', async () => {
    renderWithPaper(<OutsideState />);
    await act(async () => {});
    act(() => { fireEvent.changeText(screen.getByTestId('inp'), 'ABCD'); });
    console.log('OUTSIDE after sync act:', screen.getByTestId('inp').props.value);
    await act(async () => {});
    console.log('OUTSIDE after microtask:', screen.getByTestId('inp').props.value);
  });

  it('inside — sync?', async () => {
    renderWithPaper(<InsideState />);
    await act(async () => {});
    act(() => { fireEvent.changeText(screen.getByTestId('inp'), 'ABCD'); });
    console.log('INSIDE after sync act:', screen.getByTestId('inp').props.value);
    await act(async () => {});
    console.log('INSIDE after microtask:', screen.getByTestId('inp').props.value);
  });
});
