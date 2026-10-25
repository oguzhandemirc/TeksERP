// =============================================================================
// Önceki adım hataları (KQ-D7) — gri, salt-okunur, künyeli liste + ⚠N rozeti
// =============================================================================
// (1) künye "istasyon · kişi · saat" (fabrika dilimi), eksik parça atlanır;
// (2) metresiz satır cetvele girmez; (3) panelde liste çizilir, dokunuş silme açmaz;
// (4) rozet sıfırda/undefined'da çizilmez.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import InspectionPanel, { priorDefectKunye, toInspectionPriorDefects } from './InspectionPanel';
import PriorErrorBadge from './PriorErrorBadge';
import type { DefectType } from '../../types/models';

jest.mock('../NumpadInput', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return {
    __esModule: true,
    default: (p: { value: string; onChangeText: (v: string) => void }) => (
      <TextInput testID="meter" value={p.value} onChangeText={p.onChangeText} />
    ),
  };
});

const TYPES = [{ id: 't-leke', code: 'LEKE', name: 'Leke', description: null, severity: 'MINOR', isActive: true }] as DefectType[];
const PRIOR = [
  { id: 'p1', startMeter: 12, errorType: 'Leke', detectedStationName: 'KK Masa 2', detectedByName: 'Ayşe', detectedAt: '2026-10-25T10:40:00.000Z' },
  { id: 'p2', startMeter: null, errorType: 'Delik', detectedStationName: null, detectedByName: null, detectedAt: '2026-10-25T10:41:00.000Z' },
];

describe('önceki adım hataları', () => {
  it('künye istasyon · kişi · saat; eksik parça atlanır', () => {
    const k = priorDefectKunye(PRIOR[0]!);
    expect(k.startsWith('KK Masa 2 · Ayşe · ')).toBe(true);
    expect(k).toMatch(/\d{2}:\d{2}$/);
    expect(priorDefectKunye({ detectedStationName: 'Kurşun 1', detectedByName: null, detectedAt: null })).toBe('Kurşun 1');
  });

  it('metresiz satır düşer', () => {
    const list = toInspectionPriorDefects(PRIOR);
    expect(list.map((d) => d.id)).toEqual(['p1']);
    expect(toInspectionPriorDefects(undefined)).toEqual([]);
  });

  it('panel önceki hataları gri listede gösterir; dokunuş silme açmaz', () => {
    const onDelete = jest.fn();
    const r = renderWithPaper(
      <InspectionPanel
        defectTypes={TYPES}
        ownDefects={[]}
        priorDefects={toInspectionPriorDefects(PRIOR)}
        meterInput=""
        onMeterChange={jest.fn()}
        onDefect={jest.fn()}
        onDelete={onDelete}
      />,
    );
    expect(r.getByTestId('prior-defect-list')).toBeTruthy();
    expect(r.getByText('önceki 1')).toBeTruthy(); // cetvel başlığına gömülü (yükseklik eklemez)
    fireEvent.press(r.getAllByText('Leke')[0]!); // önceki listedeki satır
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('önceki hata yoksa liste çizilmez', () => {
    const r = renderWithPaper(
      <InspectionPanel defectTypes={TYPES} ownDefects={[]} meterInput="" onMeterChange={jest.fn()} onDefect={jest.fn()} onDelete={jest.fn()} />,
    );
    expect(r.queryByTestId('prior-defect-list')).toBeNull();
  });

  it('⚠N rozeti yalnız N > 0 iken', () => {
    expect(renderWithPaper(<PriorErrorBadge count={3} testID="b" />).getByText('⚠ 3')).toBeTruthy();
    expect(renderWithPaper(<PriorErrorBadge count={0} testID="b" />).queryByTestId('b')).toBeNull();
    expect(renderWithPaper(<PriorErrorBadge count={undefined} testID="b" />).queryByTestId('b')).toBeNull();
  });
});
