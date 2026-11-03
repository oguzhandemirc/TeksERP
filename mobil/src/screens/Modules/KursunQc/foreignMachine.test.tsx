// K16 bekçisi — başka makineye atanmış iş okutulunca "Yine de al" istemi (fabrika cevabı 14/21-ek).
// Engel yok: Vazgeç kartı açmaz, Yine de al iz yazdırır (sunucu ucu) sonra açar. Eski backend alanı göndermez → istem yok.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import ForeignMachinePrompt from './ForeignMachinePrompt';

const PROMPT = { barcode: 'RK-1', fromInput: true, batchNumber: 'P-42', plannedMachineName: 'Kurşun M2' };

describe('ForeignMachinePrompt', () => {
  it('atanan makine adıyla uyarır; Yine de al / Vazgeç doğru eylemi çağırır', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const r = renderWithPaper(<ForeignMachinePrompt prompt={PROMPT} busy={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(r.getByText('Kurşun M2')).toBeTruthy();
    fireEvent.press(r.getByTestId('foreign-machine-take'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(r.getByTestId('foreign-machine-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('istem yoksa çizilmez', () => {
    const r = renderWithPaper(<ForeignMachinePrompt prompt={null} busy={false} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(r.queryByTestId('foreign-machine-prompt')).toBeNull();
  });
  it('⭐ ekran bağlantısı: okutmada foreignMachine varsa iş AÇILMADAN istem kurulur; onayda önce iz ucu, sonra açılış', () => {
    // Ekran 2800+ satır; render yerine kaynakta sıra ölçülür (widthPrecheck §8 emsali).
    const src = jest.requireActual<typeof import('fs')>('fs').readFileSync(require.resolve('./KursunQcScreen.tsx'), 'utf8');
    const resolve = src.slice(src.indexOf('const res = await kursunQcService.getByCardBarcode(barcode);'), src.indexOf('const openResolvedStep = ('));
    const guard = resolve.indexOf('if (step.foreignMachine)');
    expect(guard).toBeGreaterThan(-1);
    expect(resolve.slice(guard, resolve.indexOf('return;', guard))).toMatch(/setForeignPrompt\(/);
    expect(guard).toBeLessThan(resolve.lastIndexOf('openResolvedStep(barcode, step, fromInput, false)'));
    const confirm = src.slice(src.indexOf('const confirmForeign = async'), src.indexOf('const cancelForeign'));
    expect(confirm.indexOf('takeForeignMachine(')).toBeGreaterThan(-1);
    expect(confirm.indexOf('takeForeignMachine(')).toBeLessThan(confirm.indexOf('openResolvedStep('));
    expect(src).toMatch(/<ForeignMachinePrompt prompt=\{foreignPrompt\}/);
  });
});
