// Gülkesim provası 2026-11-06: son top tamamlanınca "Adımı Kapat" görünmüyordu → iş tambura düşmedi.
// Panel sonraki istasyonu adlar ve tek dokunuşla kapanışı çağırır.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import AllDoneFinishPanel from './AllDoneFinishPanel';
import { allDoneHint } from './stationPanels';

describe('AllDoneFinishPanel', () => {
  it('sonraki istasyonu adlar, düğme kapanışı TEK kez çağırır', () => {
    const onFinish = jest.fn();
    const { getByTestId, getByText } = renderWithPaper(
      <AllDoneFinishPanel rollCount={1} nextStepName="TAMBUR-1" onFinish={onFinish} />,
    );
    expect(getByText('Bütün toplar tamamlandı (1)')).toBeTruthy();
    expect(getByText(/Adımı Kapat — Toplar TAMBUR-1/)).toBeTruthy();
    fireEvent.press(getByTestId('kursun-all-done-finish'));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('son adımda yönsüz metin; eski backend (alan yok) Tambur der', () => {
    expect(allDoneHint(null)).toBe('Adımı kapatınca bu istasyondaki iş biter.');
    expect(allDoneHint(undefined)).toMatch(/^Adımı kapatınca iş Tambur/);
    expect(allDoneHint('DETAYLI KK')).toMatch(/^Adımı kapatınca iş DETAYLI KK/);
  });
});
