// K4P-TABLET — KK1 muayene paneli: 4 puan modunda bileşen, GERİ AL son kaydı siler, TASLAĞI SİL onaylı.
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import Kk1InspectionSheet from './Kk1InspectionSheet';
import type { Kk1Inspection } from './useKk1Inspection';

jest.mock('../../../components/NumpadInput', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return { __esModule: true, default: (p: { value: string }) => <TextInput testID="meter" value={p.value} /> };
});

function fakeInsp(): Kk1Inspection {
  const defects = [
    { id: 'a', defectTypeId: 't1', sizeClass: 'S2' as const, meter: 37.5, points: 2 },
    { id: 'b', defectTypeId: 't2', sizeClass: null, meter: null, points: 4 },
  ];
  return {
    visible: true,
    open: true,
    draft: { defects, note: '', inspectedLengthM: null },
    dispatch: jest.fn(),
    defectTypes: [
      { id: 't1', code: 'LEKE', name: 'Leke', description: null, severity: 'MINOR', isActive: true, fixedPoints: null },
      { id: 't2', code: 'DELIK', name: 'Delik', description: null, severity: 'MAJOR', isActive: true, fixedPoints: 4 },
    ],
    meterInput: '',
    setMeterInput: jest.fn(),
    onDefect: jest.fn(),
    ownDefects: [{ id: 'a', startMeter: 37.5, defectTypeId: 't1', errorType: 'Leke' }],
    summary: { defectCount: 2, totalPoints: 6, per100M2: '4.2', widthSource: 'ITEM_CARD', offline: false, previewNote: null },
  } as unknown as Kk1Inspection;
}

describe('Kk1InspectionSheet', () => {
  it('son kayıtlar (konumsuz dahil) + özet; GERİ AL son kaydı geri alır', async () => {
    const insp = fakeInsp();
    const r = renderWithPaper(<Kk1InspectionSheet insp={insp} compact={false} onClose={jest.fn()} />);
    await act(async () => {});
    expect(r.getByText('37.5 m')).toBeOnTheScreen();
    expect(r.getByText('—')).toBeOnTheScreen();
    expect(r.getByText('PUAN 6')).toBeOnTheScreen();
    expect(r.getByTestId('inspection-size-strip')).toBeOnTheScreen();
    fireEvent.press(r.getByTestId('inspection-undo'));
    expect(insp.dispatch).toHaveBeenCalledWith({ type: 'undoLast' });
  });

  it('TASLAĞI SİL onay ister; onayda temizler', async () => {
    const insp = fakeInsp();
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = renderWithPaper(<Kk1InspectionSheet insp={insp} compact={false} onClose={jest.fn()} />);
    await act(async () => {});
    fireEvent.press(r.getByTestId('kk1-inspection-clear'));
    expect(insp.dispatch).not.toHaveBeenCalled();
    const buttons = spy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Sil')!.onPress!();
    expect(insp.dispatch).toHaveBeenCalledWith({ type: 'clear' });
  });
});
