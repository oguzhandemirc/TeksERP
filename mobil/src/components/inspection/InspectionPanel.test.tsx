// =============================================================================
// InspectionPanel — TEK hata giriş bileşeni bekçisi (KQ-D3, plan §3.7)
// =============================================================================
// (1) dokunuş onDefect'i doğru girdiyle çağırır, (2) readOnly'de çağırmaz,
// (3) geçersiz/mükerrer girdide çağırmaz, (4) 4 puan modunda boyut sorar,
// (5) kaynakta istasyon türü/ekran adı karşılaştırması YOK (her bileşimde aynı panel).
import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import InspectionPanel, { inspectionSaveErrorText, validateDefectInput } from './InspectionPanel';
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

const TYPES: DefectType[] = [
  { id: 't-leke', code: 'LEKE', name: 'Leke', description: null, severity: 'MINOR', isActive: true },
  { id: 't-delik', code: 'DELIK', name: 'Delik', description: null, severity: 'CRITICAL', isActive: true },
] as DefectType[];

function setup(over: Partial<React.ComponentProps<typeof InspectionPanel>> = {}) {
  const onDefect = jest.fn();
  const onDelete = jest.fn();
  const r = renderWithPaper(
    <InspectionPanel
      defectTypes={TYPES}
      ownDefects={[]}
      meterInput="64.5"
      onMeterChange={jest.fn()}
      onDefect={onDefect}
      onDelete={onDelete}
      maxMeter={118}
      {...over}
    />,
  );
  return { r, onDefect, onDelete };
}

describe('InspectionPanel', () => {
  it('tip dokunuşu onDefect({meter, defectTypeId}) çağırır', async () => {
    const { r, onDefect } = setup();
    await act(async () => {});
    fireEvent.press(r.getByTestId('inspection-type-t-leke'));
    expect(onDefect).toHaveBeenCalledTimes(1);
    expect(onDefect).toHaveBeenCalledWith({ meter: 64.5, defectTypeId: 't-leke' });
  });

  it('readOnly iken giriş çizilmez, onDefect çağrılmaz', async () => {
    const { r, onDefect } = setup({ readOnly: true });
    await act(async () => {});
    expect(r.queryByTestId('inspection-type-t-leke')).toBeNull();
    expect(onDefect).not.toHaveBeenCalled();
  });

  it('metre boş / topu aşan / mükerrer girdide onDefect çağrılmaz', async () => {
    const bos = setup({ meterInput: '' });
    await act(async () => {});
    fireEvent.press(bos.r.getByTestId('inspection-type-t-leke'));
    expect(bos.onDefect).not.toHaveBeenCalled();

    const asan = setup({ meterInput: '200' });
    await act(async () => {});
    fireEvent.press(asan.r.getByTestId('inspection-type-t-leke'));
    expect(asan.onDefect).not.toHaveBeenCalled();

    const muk = setup({
      ownDefects: [{ id: 'e1', startMeter: 64.5, defectTypeId: 't-leke', errorType: 'Leke' }],
    });
    await act(async () => {});
    fireEvent.press(muk.r.getByTestId('inspection-type-t-leke'));
    expect(muk.onDefect).not.toHaveBeenCalled();
    // Aynı metrede FARKLI tip serbest.
    fireEvent.press(muk.r.getByTestId('inspection-type-t-delik'));
    expect(muk.onDefect).toHaveBeenCalledWith({ meter: 64.5, defectTypeId: 't-delik' });
  });

  it('4 puan modunda tip dokunuşu boyut sorar, boyutla onDefect çağrılır', async () => {
    const { r, onDefect } = setup({ sizeClassMode: true });
    await act(async () => {});
    fireEvent.press(r.getByTestId('inspection-type-t-delik'));
    expect(onDefect).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('inspection-size-S3'));
    expect(onDefect).toHaveBeenCalledWith({ meter: 64.5, defectTypeId: 't-delik', sizeClass: 'S3' });
  });

  it('önceki adım hataları rozetle görünür (gri, salt-okunur)', async () => {
    const { r } = setup({
      priorDefects: [{ id: 'p1', startMeter: 10, defectTypeId: 't-leke', errorType: 'Leke', origin: 'Kurşun · Ali' }],
    });
    await act(async () => {});
    expect(r.getByTestId('inspection-prior-badge')).toBeOnTheScreen();
    expect(r.getByText('önceki 1')).toBeOnTheScreen();
  });

  it('mükerrer 409 "zaten kayıtlı" metnine çevrilir', () => {
    expect(inspectionSaveErrorText({ status: 409, details: { code: 'DUPLICATE_ROLL_ERROR' } })).toBe('Bu hata zaten kayıtlı');
    expect(inspectionSaveErrorText({ status: 400, details: {} })).toBeNull();
    expect(validateDefectInput('12', 't', [], 10).ok).toBe(false);
  });

  it('kaynakta istasyon türü / ekran adı karşılaştırması YOK', () => {
    // Panel birkaç dosyaya bölündü: dizindeki TÜM kaynaklar taranır.
    const files = fs.readdirSync(__dirname).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThanOrEqual(5);
    const src = files.map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/kind\s*===|StationKind|stationKind|screenName|KursunQc|Tambur(Screen)?\b.*===/);
  });
});
