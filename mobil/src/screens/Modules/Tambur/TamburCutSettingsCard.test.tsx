// Kat · En · Kalite tek satırı: başlıksız; Kat tek düğme (dokun → sıradaki), Kalite tek düğme + açılır liste.
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburCutSettingsCard from './TamburCutSettingsCard';

jest.mock('../../../components/NumpadInput', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return {
    __esModule: true,
    default: (p: { value: string; placeholder?: string; testID?: string }) => <TextInput testID={p.testID} value={p.value} placeholder={p.placeholder} />,
  };
});

const grades = [
  { id: '1', code: 'Q1', name: '1. Kalite' },
  { id: '2', code: 'A1', name: 'A1' },
];

function card(over: { fold?: string; quality?: string | null } = {}) {
  const onFold = jest.fn();
  const onQuality = jest.fn();
  const r = renderWithPaper(
    <TamburCutSettingsCard
      fold={{ options: [{ code: '2-KAT', name: '2 Kat' }, { code: '4-KAT', name: '4 Kat' }], value: over.fold ?? '4-KAT', onPick: onFold }}
      width={{ value: '', onChange: jest.fn(), placeholder: 'En (cm)' }}
      quality={{ grades, value: over.quality === undefined ? 'Q1' : over.quality, onPick: onQuality }}
    />,
  );
  return { r, onFold, onQuality };
}

describe('TamburCutSettingsCard', () => {
  it('başlık yok; değerler kendini anlatır', () => {
    const { r } = card();
    expect(r.getByText('4 Kat')).toBeTruthy();
    expect(r.getByText('1. Kalite')).toBeTruthy();
    expect(r.getByTestId('tambur-en-cm').props.placeholder).toBe('En (cm)');
    expect(r.queryByText('Tambur (kat)')).toBeNull();
    expect(r.queryByText('Kalite')).toBeNull();
  });

  it('kat düğmesi sıradaki kata geçer', () => {
    const { r, onFold } = card();
    fireEvent.press(r.getByTestId('tambur-kat-dugmesi'));
    expect(onFold).toHaveBeenCalledWith('2-KAT');
  });

  it('kalite düğmesi açılır liste açar; seçim "kaldır" değil seçimdir', async () => {
    const { r, onQuality } = card();
    fireEvent.press(r.getByTestId('tambur-kalite-dugmesi'));
    await waitFor(() => expect(r.getByTestId('tambur-kalite-A1')).toBeTruthy());
    fireEvent.press(r.getByTestId('tambur-kalite-A1'));
    expect(onQuality).toHaveBeenCalledWith(grades[1], false);
  });
});
