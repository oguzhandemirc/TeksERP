// Ön-dolu sayı kutusu (`selectAllOnFocus`): yazılan eskisinin YERİNE geçer (Devere kabul 1500 → "20" = 20, 150020 değil).
import React, { useState } from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../test/render';
import NumpadInput, { replaceFirstKey } from './NumpadInput';
import { NumpadModalHost, NumpadProvider } from './NumpadProvider';

describe('replaceFirstKey', () => {
  it('ilk tuş eski değerin yerine geçer; silme boşaltır; ondalık 0. olur', () => {
    expect(replaceFirstKey('1500', '15002')).toBe('2');
    expect(replaceFirstKey('1500', '150')).toBe('');
    expect(replaceFirstKey('1500', '1500.')).toBe('0.');
    expect(replaceFirstKey('', '7')).toBe('7');
    expect(replaceFirstKey('1500', '1500')).toBe('1500');
  });
});

function Harness({ selectAll }: { selectAll: boolean }) {
  const [v, setV] = useState('1500');
  return (
    <NumpadProvider>
      <NumpadInput testID="metre" value={v} onChangeText={setV} numpadLabel="Metre" selectAllOnFocus={selectAll} />
      <NumpadModalHost />
    </NumpadProvider>
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('NumpadInput selectAllOnFocus — tuş takımı kipi', () => {
  it('açık: 1500 üstüne 2 0 → 20', async () => {
    const r = renderWithPaper(<Harness selectAll />);
    fireEvent(r.getByTestId('metre'), 'focus');
    await waitFor(() => expect(r.getAllByText('Tamam')).toHaveLength(1));
    fireEvent.press(r.getByText('2'));
    await waitFor(() => expect(r.getByTestId('metre').props.value).toBe('2'));
    fireEvent.press(r.getByText('0'));
    await waitFor(() => expect(r.getByTestId('metre').props.value).toBe('20'));
  });

  it('kapalı (varsayılan): bugünkü davranış, sonuna ekler', async () => {
    const r = renderWithPaper(<Harness selectAll={false} />);
    fireEvent(r.getByTestId('metre'), 'focus');
    await waitFor(() => expect(r.getAllByText('Tamam')).toHaveLength(1));
    fireEvent.press(r.getByText('2'));
    expect(r.getByTestId('metre').props.value).toBe('15002');
  });
});
