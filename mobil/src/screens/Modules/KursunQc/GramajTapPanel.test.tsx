// =============================================================================
// KQ-D5 bekçisi — tek dokunuş gramaj paneli (hook + sunum birlikte)
// =============================================================================
// (1) dokunuş completeQc2'yi TEK kez doğru gövdeyle çağırır (kilit çift
// dokunuşu yutar), (2) hedef dışı değer yazmayı engellemez ve şeridi gösterir,
// (3) "Kurşunsuz geç" yalnız KURSUN OPSİYONEL'de, (4) DÜZELT ikinci çağrıyı
// yeni değerle yapar, 409'da "liste yenilendi" der.
import React, { useState } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { renderWithPaper } from '../../../test/render';
import { STATION_MUT } from '../../../offline/mutations';
import GramajTapPanel from './GramajTapPanel';
import { useGramajTap, type GramajTapInput } from './useGramajTap';
import { composeStationPanels } from './stationPanels';
import type { KursunStepSummary } from '../../../types/models';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const VALUES = [
  { code: '25GR', name: '25 gr' },
  { code: '50GR', name: '50 gr' },
  { code: '75GR', name: '75 gr' },
];

function summary(flagMode: 'AUTO' | 'OPTIONAL' | 'REQUIRED', target: string | null): KursunStepSummary {
  return {
    workOrderStepId: 'step-1',
    inspectionEnabled: false,
    properties: [
      { propertyId: 'kursun', code: 'KURSUN', name: 'Kurşunlu', mode: flagMode, valueType: 'FLAG', values: [] },
      { propertyId: 'gramaj', code: 'GRAMAJ', name: 'Kurşun gramajı', mode: 'OPTIONAL', valueType: 'CHOICE', values: VALUES, variantOfPropertyId: 'kursun' },
    ],
    targetValues: target ? [{ propertyId: 'gramaj', valueId: 'v', valueCode: target }] : [],
    rolls: [],
  } as unknown as KursunStepSummary;
}

function Harness(p: { s: KursunStepSummary; complete: GramajTapInput['complete']; correctFn: jest.Mock; stopOpen?: boolean }) {
  const qc = useQueryClient();
  useState(() => {
    qc.setMutationDefaults(STATION_MUT.QC2_COMPLETE, { mutationFn: p.correctFn, retry: false });
    return true;
  });
  const panels = composeStationPanels({ inspectionEnabled: false, properties: p.s.properties ?? [] });
  const state = useGramajTap({
    cfg: panels.tap,
    summary: p.s,
    roll: { rollId: 'roll-1', barcode: 'T000123456' },
    operator: 'Ayşe',
    complete: p.complete,
    refresh: jest.fn(),
    stopOpen: p.stopOpen,
  });
  return <GramajTapPanel state={state} hasRoll />;
}

function setup(flagMode: 'AUTO' | 'OPTIONAL' | 'REQUIRED' = 'REQUIRED', target: string | null = '50GR', stopOpen?: boolean) {
  const settle: (() => void)[] = [];
  const complete = jest.fn((_vars, opts: { onSuccess?: () => void; onSettled?: () => void }) => {
    settle.push(() => {
      opts.onSuccess?.();
      opts.onSettled?.();
    });
  });
  const correctFn = jest.fn().mockResolvedValue({ success: true });
  const r = renderWithPaper(<Harness s={summary(flagMode, target)} complete={complete} correctFn={correctFn} stopOpen={stopOpen} />);
  const done = () => act(() => settle.splice(0).forEach((f) => f()));
  return { ...r, complete, correctFn, done };
}

describe('GramajTapPanel — tek dokunuş', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dokunuş completeQc2 gövdesini TEK kez yollar; uçarken ikinci dokunuş yutulur', () => {
    const { getByTestId, complete } = setup('REQUIRED');
    fireEvent.press(getByTestId('gramaj-tap-50GR'));
    fireEvent.press(getByTestId('gramaj-tap-50GR'));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toEqual({
      rollId: 'roll-1',
      stepId: 'step-1',
      properties: [{ propertyId: 'gramaj', valueCode: '50GR' }, { propertyId: 'kursun' }],
    });
  });

  it('KURSUN AUTO iken bayrak gövdeye girmez (backend kendi yazar)', () => {
    const { getByTestId, complete } = setup('AUTO');
    fireEvent.press(getByTestId('gramaj-tap-25GR'));
    expect(complete.mock.calls[0][0].properties).toEqual([{ propertyId: 'gramaj', valueCode: '25GR' }]);
  });

  it('hedef ★ ve başlıkta; hedef dışı basış yazar ve şeritte sapma gösterir', () => {
    const { getByTestId, getByText, complete, done } = setup('REQUIRED', '50GR');
    expect(getByTestId('gramaj-hedef')).toHaveTextContent('HEDEF 50 gr');
    expect(getByTestId('gramaj-top')).toHaveTextContent('Top 3456');
    expect(getByText('★ 50 gr')).toBeTruthy();
    fireEvent.press(getByTestId('gramaj-tap-25GR'));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(getByTestId('gramaj-sapma')).toHaveTextContent('Hedef 50 gr, 25 gr işlendi');
    expect(getByTestId('gramaj-strip')).toHaveTextContent(/Son: 3456 · 25 gr · Ayşe · \d\d:\d\d/);
    done();
  });

  it('hedef yoksa vurgu ve sapma yok', () => {
    const { queryByTestId, queryByText, getByTestId } = setup('REQUIRED', null);
    expect(queryByTestId('gramaj-hedef')).toBeNull();
    expect(queryByText(/★/)).toBeNull();
    fireEvent.press(getByTestId('gramaj-tap-25GR'));
    expect(queryByTestId('gramaj-sapma')).toBeNull();
  });

  it('"Kurşunsuz geç" yalnız KURSUN OPSİYONEL iken; boş gövdeyle tamamlar', () => {
    expect(setup('REQUIRED').queryByTestId('gramaj-skip')).toBeNull();
    expect(setup('AUTO').queryByTestId('gramaj-skip')).toBeNull();
    const { getAllByTestId, complete } = setup('OPTIONAL');
    fireEvent.press(getAllByTestId('gramaj-skip').at(-1)!);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].properties).toEqual([]);
  });

  it('DÜZELT ikinci çağrıyı aynı top için yeni değerle yapar', async () => {
    const { getByTestId, complete, correctFn, done } = setup('REQUIRED');
    fireEvent.press(getByTestId('gramaj-tap-25GR'));
    done();
    fireEvent.press(getByTestId('gramaj-duzelt'));
    fireEvent.press(getByTestId('gramaj-tap-50GR'));
    await waitFor(() => expect(correctFn).toHaveBeenCalledTimes(1));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(correctFn.mock.calls[0][0]).toEqual({
      rollId: 'roll-1',
      stepId: 'step-1',
      properties: [{ propertyId: 'gramaj', valueCode: '50GR' }, { propertyId: 'kursun' }],
    });
    expect(getByTestId('gramaj-strip')).toHaveTextContent(/50 gr/);
  });

  it('düzeltmede 409 → "Başka bir düzeltme yapıldı, liste yenilendi"', async () => {
    const { getByTestId, correctFn, done } = setup('REQUIRED');
    correctFn.mockRejectedValueOnce(Object.assign(new Error('çakışma'), { status: 409 }));
    fireEvent.press(getByTestId('gramaj-tap-25GR'));
    done();
    fireEvent.press(getByTestId('gramaj-duzelt'));
    fireEvent.press(getByTestId('gramaj-tap-75GR'));
    await waitFor(() =>
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text1: 'Başka bir düzeltme yapıldı, liste yenilendi' }),
      ),
    );
    // Yazılmayan düzeltme şeritte görünmez — eski değer geri gelir.
    expect(getByTestId('gramaj-strip')).toHaveTextContent(/25 gr/);
  });
});

describe('GramajTapPanel — açık duruş (D4-A2)', () => {
  beforeEach(() => jest.clearAllMocks());

  // D4-A2 · K2: açık duruş dokunuşu UYARIR, reddetmez — gövde duruşsuzla aynı, TEK kez gider.
  it('açık duruşta gramaj dokunuşu UYARIR, gönderim sürer (K2)', () => {
    const { getByTestId, complete } = setup('REQUIRED', '50GR', true);
    fireEvent.press(getByTestId('gramaj-tap-50GR'));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toEqual({
      rollId: 'roll-1',
      stepId: 'step-1',
      properties: [{ propertyId: 'gramaj', valueCode: '50GR' }, { propertyId: 'kursun' }],
    });
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text1: 'Makine duruşta görünüyor — kayıt yine gönderildi' }));
  });

  it('duruş yokken uyarı yok (bugünkü dokunuş)', () => {
    const { getByTestId, complete } = setup('REQUIRED', '50GR', false);
    fireEvent.press(getByTestId('gramaj-tap-50GR'));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(Toast.show).not.toHaveBeenCalled();
  });
});
