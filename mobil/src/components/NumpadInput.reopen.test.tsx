// Tuş takımı kapandıktan sonra aynı kutuya ikinci dokunuş tuş takımını yeniden açar (GK 2026-11-11 saha hatası:
// native odak kutuda kaldığı için onFocus gelmiyor, önce başka yere dokunmak gerekiyordu).
// Negatif sonda: NumpadInput'tan onPressIn kaldırılınca "ikinci basış" kırmızı.
import React, { useState } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../test/render';
import NumpadInput from './NumpadInput';
import { NumpadModalHost, NumpadProvider } from './NumpadProvider';

function Harness() {
  const [v, setV] = useState('');
  return (
    <NumpadProvider>
      <NumpadInput testID="metre" value={v} onChangeText={setV} numpadLabel="Metre" />
      <NumpadModalHost />
    </NumpadProvider>
  );
}

describe('NumpadInput — kapandıktan sonra yeniden açılma', () => {
  it('Tamam ile kapatılan tuş takımı aynı kutuya ikinci basışta yeniden açılır', async () => {
    const r = renderWithPaper(<Harness />);
    fireEvent(r.getByTestId('metre'), 'focus');
    await waitFor(() => expect(r.getByText('Tamam')).toBeTruthy());
    fireEvent.press(r.getByText('Tamam'));
    await waitFor(() => expect(r.queryByText('Tamam')).toBeNull());
    // Native odak kutuda kaldı varsayımı: focus olayı YOK, yalnız basış.
    await act(async () => {
      fireEvent(r.getByTestId('metre'), 'pressIn', { nativeEvent: {} });
    });
    await waitFor(() => expect(r.getByText('Tamam')).toBeTruthy());
  });

  it('açıkken tekrar basmak zararsız (çift açılma tek tuş takımı)', async () => {
    const r = renderWithPaper(<Harness />);
    fireEvent(r.getByTestId('metre'), 'focus');
    fireEvent(r.getByTestId('metre'), 'pressIn', { nativeEvent: {} });
    await waitFor(() => expect(r.getAllByText('Tamam')).toHaveLength(1));
    fireEvent.press(r.getByText('7'));
    expect(r.getByTestId('metre').props.value).toBe('7');
  });
});
