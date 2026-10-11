// Uyarılar listesi: satır tezgah · sebep · süre/hedef · kademe; kapsam satırı sunucunun gerçekten
// süzüp süzmediğini söyler ("Size bildirilenler" yalnız audience=mine); anahtar o zaman çizilir.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { alarmItem, T0 } from '../../../test/loomAlarmFixture';
import AlarmListPane from './AlarmListPane';

const base = { loading: false, problemText: null, showAll: false, selectedId: null, now: T0 };

describe('AlarmListPane', () => {
  it('satır ve dokunma', () => {
    const onOpen = jest.fn();
    const r = renderWithPaper(<AlarmListPane {...base} items={[alarmItem({ tier: 2 })]} audience="mine" onShowAll={jest.fn()} onOpen={onOpen} />);
    expect(r.getByText('TZ-12 · Hol A')).toBeTruthy();
    expect(r.getByText('İp atlama')).toBeTruthy();
    expect(r.getByText('20 dk / hedef 10 dk')).toBeTruthy();
    expect(r.getByText('Kademe 2')).toBeTruthy();
    expect(r.getByText('Size bildirilenler')).toBeTruthy();
    fireEvent.press(r.getByText('TZ-12 · Hol A'));
    expect(onOpen).toHaveBeenCalledWith(alarmItem().id);
  });

  it('sunucu süzmediyse "İzninize göre tümü" ve anahtar yok', () => {
    const r = renderWithPaper(<AlarmListPane {...base} items={[]} audience="all" onShowAll={jest.fn()} onOpen={jest.fn()} />);
    expect(r.getByText('İzninize göre tümü')).toBeTruthy();
    expect(r.queryByText('Tümünü göster')).toBeNull();
    expect(r.getByText('Açık tezgah alarmı yok.')).toBeTruthy();
  });
});
