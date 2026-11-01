// =============================================================================
// D4-KUC3b bekçisi — gramaj tek dokunuşunda ölçülen en ÖN-DENETİMİ
// =============================================================================
// Sınır sunucudan gelir (adım özeti `rolls[].widthLimit`, yazım kapısıyla aynı hesap); istemci
// eşik hesaplamaz. Sınır dışı en: istek (complete) HİÇ çağrılmaz, kilit/şerit oynamaz, Türkçe uyarı.
// Negatif sonda: precheck kaldırılınca ya da measuredWidthLimitError null döndürünce §1 kırmızı.
import React, { useState } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { renderWithPaper } from '../../../test/render';
import { STATION_MUT } from '../../../offline/mutations';
import GramajTapPanel from './GramajTapPanel';
import MeasuredWidthField from './MeasuredWidthField';
import { useGramajTap } from './useGramajTap';
import { useMeasuredWidth } from './useMeasuredWidth';
import { composeStationPanels } from './stationPanels';
import { measuredWidthLimitError, type MeasuredWidthLimit } from './measuredWidth';
import type { KursunStepSummary } from '../../../types/models';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const SUMMARY = {
  workOrderStepId: 'step-1',
  inspectionEnabled: false,
  capturesWidth: true,
  properties: [
    { propertyId: 'kursun', code: 'KURSUN', name: 'Kurşunlu', mode: 'REQUIRED', valueType: 'FLAG', values: [] },
    {
      propertyId: 'gramaj',
      code: 'GRAMAJ',
      name: 'Kurşun gramajı',
      mode: 'OPTIONAL',
      valueType: 'CHOICE',
      values: [{ code: '50GR', name: '50 gr' }],
      variantOfPropertyId: 'kursun',
    },
  ],
  targetValues: [],
  rolls: [],
} as unknown as KursunStepSummary;

/** Ekranın kurduğu düzenin aynası: en alanı + gramaj paneli; complete öncesi attach, dokunuş öncesi precheck. */
function Harness({ limit, complete }: { limit?: MeasuredWidthLimit; complete: jest.Mock }) {
  const qc = useQueryClient();
  useState(() => {
    qc.setMutationDefaults(STATION_MUT.QC2_COMPLETE, { mutationFn: jest.fn(), retry: false });
    return true;
  });
  const width = useMeasuredWidth(true, 'roll-1', limit);
  const panels = composeStationPanels({ inspectionEnabled: false, properties: SUMMARY.properties ?? [] });
  const tap = useGramajTap({
    cfg: panels.tap,
    summary: SUMMARY,
    roll: { rollId: 'roll-1', barcode: 'T000123456' },
    operator: 'Ayşe',
    complete: (vars, opts) => {
      const v = width.attach(vars);
      if (v) complete(v, opts);
      else opts.onSettled?.();
    },
    refresh: jest.fn(),
    precheck: (rollId) => width.attach({ rollId }) !== null,
  });
  return (
    <>
      <MeasuredWidthField state={width} />
      <GramajTapPanel state={tap} hasRoll />
    </>
  );
}

const LIMIT_10: MeasuredWidthLimit = { widthBefore: 300, toleranceCm: 10, maxCm: 310 };

function tapWith(text: string, limit?: MeasuredWidthLimit) {
  const complete = jest.fn();
  const r = renderWithPaper(<Harness limit={limit} complete={complete} />);
  fireEvent.changeText(r.getByTestId('olculen-en-giris'), text);
  fireEvent.press(r.getByTestId('gramaj-tap-50GR'));
  return { ...r, complete };
}

describe('Gramaj tek dokunuş — ölçülen en ön-denetimi', () => {
  beforeEach(() => jest.clearAllMocks());

  it('§1 ⭐ sınır dışı en (311 > 300 + 10) → istek GİTMEZ, şerit yazılmaz, Türkçe uyarı', () => {
    const { complete, queryByTestId } = tapWith('311', LIMIT_10);
    expect(complete).not.toHaveBeenCalled();
    expect(queryByTestId('gramaj-strip')).toBeNull();
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        text1: 'Ölçülen en sınır dışı',
        text2: "Ölçülen en 0'dan büyük ve en fazla 310 cm olmalı (mevcut en 300 cm + eşik 10 cm)",
      }),
    );
  });

  it('§2 ⭐ sınırdaki en (310) → tek istek, gövdede measuredWidthCm=310', () => {
    const { complete } = tapWith('310', LIMIT_10);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({ rollId: 'roll-1', stepId: 'step-1', measuredWidthCm: 310 });
  });

  it('§3 ⭐ eşik sunucudan: ayar 25 iken (üst 325) 320 geçer — istemcide kopya eşik yok', () => {
    const { complete } = tapWith('320', { widthBefore: 300, toleranceCm: 25, maxCm: 325 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({ measuredWidthCm: 320 });
  });

  it('§4 sınır yok (eski backend / en bilinmiyor) → ön-denetim yok, karar sunucuda', () => {
    expect(tapWith('400').complete).toHaveBeenCalledTimes(1);
    expect(tapWith('400', { widthBefore: null, toleranceCm: 10, maxCm: null }).complete).toHaveBeenCalledTimes(1);
  });

  it('§5 boş en → dokunuş bugünkü gibi gider (anahtar yok)', () => {
    const { complete } = tapWith('', LIMIT_10);
    expect(complete).toHaveBeenCalledTimes(1);
    expect('measuredWidthCm' in complete.mock.calls[0][0]).toBe(false);
  });

  it('§6 alan ipucu sunucu sınırını söyler', () => {
    const r = renderWithPaper(<Harness limit={LIMIT_10} complete={jest.fn()} />);
    expect(r.getByText(/En fazla 310 cm\./)).toBeTruthy();
  });

  it('§7 saf: sınır içi/üstü/yok', () => {
    expect(measuredWidthLimitError(310, LIMIT_10)).toBeNull();
    expect(measuredWidthLimitError(310.5, LIMIT_10)).toMatch(/en fazla 310 cm/);
    expect(measuredWidthLimitError(999, undefined)).toBeNull();
  });
});
