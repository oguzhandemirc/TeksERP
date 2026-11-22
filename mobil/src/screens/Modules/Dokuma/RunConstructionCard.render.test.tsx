// =============================================================================
// RunConstructionCard — render (SY-M4): yapısız iş / eski sunucu → hiçbir şey; yapılı iş → salt-okunur kart
// =============================================================================
import React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { machineRunService, type RunConstruction } from '../../../services/machineRun.service';
import RunConstructionCard, { WeavingOrderWeave } from './RunConstructionCard';

jest.mock('../../../services/machineRun.service', () => ({ machineRunService: { construction: jest.fn() } }));
const construction = machineRunService.construction as jest.Mock;

const full: RunConstruction = {
  weavingOrderId: 'wo1',
  variantCode: 'V02',
  design: { code: 'D-2057', name: 'BALIK', loomFileName: 'D2057.DOP', frameCount: 8, repeatCm: 0.5 },
  weft: {
    code: 'AT-1', name: 'Tül atkı', picksPerCm: 20, sequenceCode: 'A4 B1 A4 C1', weftProgramNo: null, picksInRepeatTotal: 10,
    yarns: [
      { letter: 'A', picksInRepeat: 8, yarnCode: 'PES-150', yarnName: 'Polyester 150', swapped: false },
      { letter: 'C', picksInRepeat: 1, yarnCode: 'SIM-1', yarnName: 'Sim', swapped: true },
    ],
  },
  warpLayers: [{ role: 'LENO', beamMode: 'SEPARATE_BEAM', warpCode: 'CZ-D', warpName: 'Döner' }],
};

afterEach(() => construction.mockReset());

test('yapısız iş (null) → hiçbir şey çizilmez (bugünkü ekran)', async () => {
  construction.mockResolvedValue(null);
  const r = renderWithPaper(<RunConstructionCard weavingOrderId="wo0" />);
  await new Promise((res) => setTimeout(res, 0));
  expect(construction).toHaveBeenCalledWith('wo0');
  expect(r.queryByTestId('run-construction')).toBeNull();
  expect(r.queryByText(/Etkin yapı/)).toBeNull();
});

test('eski sunucu 404 → hiçbir şey çizilmez', async () => {
  construction.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404 } }));
  const r = renderWithPaper(<RunConstructionCard weavingOrderId="wo0" />);
  await new Promise((res) => setTimeout(res, 0));
  expect(r.queryByTestId('run-construction')).toBeNull();
});

test('yapılı iş → armür dosyası, sıklık, atkı sırası, varyant işareti; giriş alanı yok', async () => {
  construction.mockResolvedValue(full);
  const r = renderWithPaper(<RunConstructionCard weavingOrderId="wo1" />);
  await r.findByTestId('run-construction');
  expect(r.getByText(/Varyant V02/)).toBeTruthy();
  expect(r.getByText(/Armür: D2057\.DOP/)).toBeTruthy();
  expect(r.getByText(/20 atkı\/cm · Sıra A4 B1 A4 C1/)).toBeTruthy();
  expect(r.getByText(/C × 1 — SIM-1 Sim \(varyant\)/)).toBeTruthy();
  expect(r.getByText(/Döner çözgü: CZ-D/)).toBeTruthy();
  expect(r.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  // Eski sunucu armür alanı göndermez → görsel yok, metin kart aynen.
  expect(r.queryByTestId('weave-mini')).toBeNull();
});

test('sunucu armür + seçici gönderiyorsa mini görsel; dokununca tam ekran, yön çevrilir', async () => {
  const withGrid: RunConstruction = {
    ...full,
    design: { ...full.design!, liftPlan: [[1, 0, 1], [0, 1, 0], [1, 1, 0]], lenoFrames: [1], kind: 'LENO' },
    weft: { ...full.weft!, pickSequence: [1, 2, 1] },
  };
  construction.mockResolvedValue(withGrid);
  const r = renderWithPaper(<RunConstructionCard weavingOrderId="wo1" />);
  await r.findByTestId('weave-mini');
  expect(r.getByText('3 atkı · 3 çerçeve')).toBeTruthy();
  fireEvent.press(r.getByTestId('weave-mini'));
  await act(async () => {});
  expect(await r.findByTestId('weave-full')).toBeTruthy();
  expect(r.getByText('Döner çerçeve')).toBeTruthy();
  expect(r.getByText(/1\. atkı en altta/)).toBeTruthy();
  fireEvent.press(r.getByTestId('weave-direction'));
  await act(async () => {});
  expect(r.getByText(/1\. atkı en üstte/)).toBeTruthy();
});

test('iş emri detayı: "Armür planı" başlığı TEK (mini kartın kendi başlığı; bölüm başlığı yok)', async () => {
  construction.mockResolvedValue({
    ...full,
    design: { ...full.design!, liftPlan: [[1, 0], [0, 1]], lenoFrames: [], kind: 'PLAIN' },
  } as RunConstruction);
  const r = renderWithPaper(<WeavingOrderWeave weavingOrderId="wo1" />);
  await r.findByTestId('dokuma-detay-armur');
  expect(r.getAllByText('Armür planı')).toHaveLength(1);
});
