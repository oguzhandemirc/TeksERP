// K4P-TABLET — InspectionPanel 4 puan modu render bekçisi: boyut şeridi, sabit puan tek dokunuş,
// konumsuz kayıt, önceki hatalar gri, özet/çevrimdışı/en-yok şeritleri, numpad'i kendiliğinden almaz.
import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import InspectionPanel from './InspectionPanel';
import type { DefectType } from '../../types/models';

const autoActivate: boolean[] = [];
jest.mock('../NumpadInput', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return {
    __esModule: true,
    default: (p: { value: string; onChangeText: (v: string) => void; autoActivate?: boolean }) => {
      autoActivate.push(p.autoActivate === true);
      return <TextInput testID="meter" value={p.value} onChangeText={p.onChangeText} />;
    },
  };
});

const TYPES = [
  { id: 't-leke', code: 'LEKE', name: 'Leke', description: null, severity: 'MINOR', isActive: true, fixedPoints: null },
  { id: 't-delik', code: 'DELIK', name: 'Delik', description: null, severity: 'CRITICAL', isActive: true, fixedPoints: 4 },
] as DefectType[];

function setup(over: Partial<React.ComponentProps<typeof InspectionPanel>> = {}) {
  const onDefect = jest.fn();
  const r = renderWithPaper(
    <InspectionPanel defectTypes={TYPES} ownDefects={[]} meterInput="" onMeterChange={jest.fn()} onDefect={onDefect} onDelete={jest.fn()} {...over} />,
  );
  return { r, onDefect };
}

beforeEach(() => {
  autoActivate.length = 0;
});

describe('InspectionPanel — 4 puan modu', () => {
  it('kapalı: boyut şeridi yok, tek dokunuş (bugünkü süreç konağı davranışı)', async () => {
    const { r, onDefect } = setup({ meterInput: '5' });
    await act(async () => {});
    expect(r.queryByTestId('inspection-size-strip')).toBeNull();
    fireEvent.press(r.getByTestId('inspection-type-t-leke'));
    expect(onDefect).toHaveBeenCalledWith({ meter: 5, defectTypeId: 't-leke' });
    expect(autoActivate.every(Boolean)).toBe(true);
  });

  it('açık: tür + boyut şeridi birlikte; boyutla kayıt; metre boşsa konumsuz', async () => {
    const { r, onDefect } = setup({ sizeClassMode: true, meterOptional: true, meterAutoActivate: false });
    await act(async () => {});
    expect(r.getByTestId('inspection-size-strip')).toBeOnTheScreen();
    expect(r.getByText('≤7,5 cm')).toBeOnTheScreen();
    fireEvent.press(r.getByTestId('inspection-type-t-leke'));
    expect(r.getByText(/Leke — boyut\?/)).toBeOnTheScreen();
    fireEvent.press(r.getByTestId('inspection-size-S2'));
    expect(onDefect).toHaveBeenCalledWith({ meter: null, defectTypeId: 't-leke', sizeClass: 'S2' });
    expect(autoActivate.some(Boolean)).toBe(false);
  });

  it('sabit puanlı tür tek dokunuşla kaydeder (boyut sorulmaz)', async () => {
    const { r, onDefect } = setup({ sizeClassMode: true, meterOptional: true, meterInput: '12' });
    await act(async () => {});
    fireEvent.press(r.getByTestId('inspection-type-t-delik'));
    expect(onDefect).toHaveBeenCalledWith({ meter: 12, defectTypeId: 't-delik' });
  });

  it('metre zorunlu konakta boş metre reddedilir', async () => {
    const { r, onDefect } = setup({ sizeClassMode: true });
    await act(async () => {});
    fireEvent.press(r.getByTestId('inspection-type-t-delik'));
    expect(onDefect).not.toHaveBeenCalled();
  });

  it('önceki hatalar gri rozetle, silinemez (onDelete yok)', async () => {
    const { r } = setup({ priorDefects: [{ id: 'p', startMeter: 3, defectTypeId: 't-leke', errorType: 'Leke', origin: 'KK · Ali' }] });
    await act(async () => {});
    expect(r.getByText('önceki 1')).toBeOnTheScreen();
    expect(r.queryByText("tik'e dokun → sil")).toBeNull();
  });

  it('özet şeridi: sayım + /100 m² + en kaynağı', async () => {
    const { r } = setup({ sizeClassMode: true, summary: { defectCount: 3, totalPoints: 7, per100M2: '9.84', widthSource: 'ITEM_CARD' } });
    await act(async () => {});
    expect(r.getByText('HATA 3')).toBeOnTheScreen();
    expect(r.getByText('PUAN 7')).toBeOnTheScreen();
    expect(r.getByTestId('inspection-per100')).toHaveTextContent('9,8 /100 m²');
    expect(r.getByText('EN: ÜRÜN KARTI')).toBeOnTheScreen();
  });

  it('çevrimdışı şeridi: /100 m² gösterilmez', async () => {
    const { r } = setup({ sizeClassMode: true, summary: { defectCount: 1, totalPoints: 2, per100M2: '1', offline: true } });
    await act(async () => {});
    expect(r.getByTestId('inspection-offline')).toBeOnTheScreen();
    expect(r.queryByTestId('inspection-per100')).toBeNull();
  });

  it('en bilinmiyor sarı şeridi', async () => {
    const { r } = setup({ sizeClassMode: true, summary: { defectCount: 0, totalPoints: 0, per100M2: null, widthSource: 'UNKNOWN' } });
    await act(async () => {});
    expect(r.getByTestId('inspection-no-width')).toHaveTextContent('Ürün kartında en yok; puan/100 hesaplanmaz');
  });
});
