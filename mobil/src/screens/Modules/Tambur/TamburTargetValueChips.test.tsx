// =============================================================================
// SY-F3 Tambur hedef değer çipi (TASARIM §7.5/3, §16.1 kabul)
// =============================================================================
// (1) hedef değersiz iş emrinde (boş liste / eski backend undefined) HİÇBİR şey
//     çizilmez → ekran bayt-aynı; (2) değer varsa "Kuşak: ZEBRA" salt-okunur çipi;
// (3) Tambur ekranı çipi adım özetinin `targetValues`inden besler (kaynak taraması).
import React from 'react';
import fs from 'fs';
import path from 'path';
import { renderWithPaper } from '../../../test/render';
import TamburTargetValueChips, { targetValueChipLabel } from './TamburTargetValueChips';
import type { TamburTargetValueChip } from '../../../types/models';

const KUSAK: TamburTargetValueChip = {
  propertyId: 'p-kusak', propertyName: 'Kuşak', valueId: 'v-zebra', valueCode: 'ZBR', valueName: 'ZEBRA',
};

describe('TamburTargetValueChips', () => {
  it('boş liste ve eski backend (undefined) → hiçbir şey çizilmez', () => {
    for (const tv of [undefined, null, []]) {
      const r = renderWithPaper(<TamburTargetValueChips targetValues={tv} />);
      expect(r.queryByTestId('tambur-hedef-deger-cipleri')).toBeNull();
      expect(r.queryByText(/:/)).toBeNull();
      r.unmount();
    }
  });

  it('hedef değer → "Kuşak: ZEBRA" çipi', () => {
    const r = renderWithPaper(<TamburTargetValueChips targetValues={[KUSAK]} />);
    expect(r.getByTestId('tambur-hedef-deger-p-kusak')).toBeTruthy();
    expect(r.getByText('Kuşak: ZEBRA')).toBeTruthy();
  });

  it('değer adı boşsa kod gösterilir', () => {
    expect(targetValueChipLabel({ ...KUSAK, valueName: '  ' })).toBe('Kuşak: ZBR');
  });

  it('Tambur ekranı çipi stepSummary.targetValues ile çizer', () => {
    const src = fs.readFileSync(path.join(__dirname, 'TamburScreen.tsx'), 'utf8');
    expect(src).toMatch(/<TamburTargetValueChips targetValues=\{activeJob\.stepSummary\.targetValues\} \/>/);
  });
});
