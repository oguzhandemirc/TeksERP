// =============================================================================
// Tambur "HATA GİR" çekmecesi (KQ-D7)
// =============================================================================
// (1) varsayılan tip ilk tuş, liste ilki uydurulmaz; (2) bu adımın hataları "kendi"
// (silinebilir), öncekiler gri + künyeli; (3) dokunuş konağa metre + tip verir;
// (4) Tambur ekranında düğme ve çekmece `inspectionEnabled`a bağlı (kaynak taraması).
import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburDefectDrawer, { orderDefaultFirst, splitTamburDefects } from './TamburDefectDrawer';
import type { DefectType, TamburRollSummary } from '../../../types/models';

jest.mock('../../../components/NumpadInput', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return {
    __esModule: true,
    default: (p: { value: string; onChangeText: (v: string) => void }) => (
      <TextInput testID="meter" value={p.value} onChangeText={p.onChangeText} />
    ),
  };
});

const TYPES = [
  { id: 't-leke', code: 'LEKE', name: 'Leke', description: null, severity: 'MINOR', isActive: true, isDefault: false },
  { id: 't-genel', code: 'GNL', name: 'Genel hata', description: null, severity: 'MINOR', isActive: true, isDefault: true },
] as DefectType[];

const ROLL = {
  rollId: 'r1', barcode: 'T1', itemCode: 'K', itemName: 'Kumaş', colorCode: null, colorName: null, currentQty: 100,
  width: null, qualityGrade: '1', properties: [], errorCount: 2, batchId: null, batchNumber: null, dispatchNo: null, branchOrdinal: null,
  errors: [
    { id: 'e-kk', startMeter: 10, errorType: 'Leke', detectedStationName: 'KK Masa 2', detectedAtStepId: 's-kk' },
    { id: 'e-tb', startMeter: 40, errorType: 'Genel hata', detectedStationName: 'Tambur 1', detectedAtStepId: 's-tb' },
  ],
} as TamburRollSummary;

describe('TamburDefectDrawer', () => {
  it('varsayılan tip ilk sıraya alınır', () => {
    expect(orderDefaultFirst(TYPES).map((t) => t.id)).toEqual(['t-genel', 't-leke']);
    expect(orderDefaultFirst([TYPES[0]!]).map((t) => t.id)).toEqual(['t-leke']);
  });

  it('bu adımın hatası kendi, öncekiler künyeli önceki', () => {
    const s = splitTamburDefects(ROLL, 's-tb');
    expect(s.own.map((d) => d.id)).toEqual(['e-tb']);
    expect(s.prior.map((d) => [d.id, d.detectedStationName])).toEqual([['e-kk', 'KK Masa 2']]);
  });

  it('metre + tip dokunuşu konağa gider', () => {
    const onDefect = jest.fn();
    const r = renderWithPaper(
      <TamburDefectDrawer visible roll={ROLL} stepId="s-tb" defectTypes={TYPES} onDefect={onDefect} onDelete={jest.fn()} onDismiss={jest.fn()} />,
    );
    expect(r.getByTestId('tambur-defect-drawer')).toBeTruthy();
    expect(r.getByText('Önceki istasyon hataları (1)')).toBeTruthy();
    fireEvent.changeText(r.getByTestId('meter'), '55');
    const leke = r.getAllByText('Leke');
    fireEvent.press(leke[leke.length - 1]!); // tip tuşu (önceki listedeki satır değil)
    expect(onDefect).toHaveBeenCalledWith({ meter: 55, defectTypeId: 't-leke' });
  });

  it('Tambur ekranında düğme ve çekmece inspectionEnabled kapısında; eski giriş yok', () => {
    const src = fs.readFileSync(path.join(__dirname, 'TamburScreen.tsx'), 'utf8');
    expect(src).toMatch(/inspectionEnabled = activeJob\?\.stepSummary\?\.inspectionEnabled === true/);
    expect(src).toMatch(/\{inspectionEnabled && \(\s*<TouchableRipple[\s\S]{0,120}setDefectDrawerOpen\(true\)/);
    expect(src).toMatch(/\{inspectionEnabled && \(\s*<TamburDefectDrawer/);
    expect(src).not.toMatch(/handleAddError|errorEntry/);
  });
});
