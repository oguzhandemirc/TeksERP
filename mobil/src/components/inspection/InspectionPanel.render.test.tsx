// K4P-TABLET — InspectionPanel 4 puan modu render bekçisi: boyut şeridi, sabit puan tek dokunuş,
// konumsuz kayıt, önceki hatalar gri, özet/çevrimdışı/en-yok şeritleri, numpad'i kendiliğinden almaz.
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, within } from '@testing-library/react-native';
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

describe('InspectionPanel — hata yokken cetvel (rulerAlways)', () => {
  it('⭐ rulerAlways: boş cetvel + "Hata Noktaları (0)", boş durum yazısı yok', async () => {
    const { r } = setup({ rulerAlways: true, maxMeter: 3935 });
    await act(async () => {});
    expect(r.getByTestId('inspection-ruler')).toBeOnTheScreen();
    expect(r.getByText('Hata Noktaları (0)')).toBeOnTheScreen();
    expect(r.queryByText('Henüz hata yok')).toBeNull();
  });

  it('varsayılan konak (rulerAlways yok): bugünkü "Henüz hata yok" boş durumu', async () => {
    const { r } = setup();
    await act(async () => {});
    expect(r.queryByTestId('inspection-ruler')).toBeNull();
    expect(r.getByText('Henüz hata yok')).toBeOnTheScreen();
  });
});

describe('InspectionPanel — top boyunu aşan metre', () => {
  it('⭐ warn: kayıt gider + sarı satır, engel yok', async () => {
    const { r, onDefect } = setup({ meterInput: '540', maxMeter: 500, overMaxMode: 'warn' });
    await act(async () => {});
    expect(r.getByText('Top beyandan uzun görünüyor (540 > 500 m)')).toBeOnTheScreen();
    fireEvent.press(r.getByTestId('inspection-type-t-leke'));
    expect(onDefect).toHaveBeenCalledWith({ meter: 540, defectTypeId: 't-leke' });
  });
  it('negatif sonda: varsayılan kip engeller, uyarı satırı yok', async () => {
    const { r, onDefect } = setup({ meterInput: '540', maxMeter: 500 });
    await act(async () => {});
    expect(r.queryByTestId('inspection-over-max')).toBeNull();
    fireEvent.press(r.getByTestId('inspection-type-t-leke'));
    expect(onDefect).not.toHaveBeenCalled();
  });
});

describe('overMaxMode konak bağı', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'Modules', rel), 'utf8');
  it('kurşun warn taşır; Tambur çekmecesi ve Muayene bugünkü engeli korur', () => {
    expect(read('KursunQc/KursunQcScreen.tsx')).toMatch(/overMaxMode="warn"/);
    expect(read('Tambur/TamburDefectDrawer.tsx')).not.toMatch(/overMaxMode/);
    expect(read('Muayene/InspectionScreen.tsx')).not.toMatch(/overMaxMode/);
  });
});

describe('InspectionPanel — giriş alta yaslı (GK kurşun, 2026-11-10)', () => {
  it('varsayılan: ayrı boşluk görünümü yok (diğer ekranlar bugünkü gibi yukarıdan dizer)', () => {
    const { r } = setup();
    expect(r.queryByTestId('inspection-entry-spacer')).toBeNull();
  });
  it('entryAtBottom: artan yerin TAMAMI giriş bloğunda (alta yaslı); ayrı boşluk görünümü yok — çift aralık olmaz', () => {
    const { r } = setup({ entryAtBottom: true, rulerAlways: true });
    expect(r.queryByTestId('inspection-entry-spacer')).toBeNull();
    expect(StyleSheet.flatten(r.getByTestId('inspection-entry-block').props.style)).toMatchObject({ flexGrow: 1, justifyContent: 'flex-end' });
    // Sıra: cetvel → metre girişi (başparmak erişimi alt blokta).
    const json = JSON.stringify(r.toJSON());
    const iRuler = json.indexOf('inspection-ruler');
    const iMeter = json.indexOf('"testID":"meter"');
    expect(iRuler).toBeGreaterThanOrEqual(0);
    expect(iRuler < iMeter).toBe(true);
  });
  it('varsayılan: giriş bloğu büyümez', () => {
    const { r } = setup();
    expect(StyleSheet.flatten(r.getByTestId('inspection-entry-block').props.style).flexGrow).toBeUndefined();
  });
});

describe('InspectionPanel — birimli metre kutusu (GK 2026-11-11)', () => {
  it('birim "m" kutunun içinde; kutu tür düğmeleriyle aynı satırda (ilk hücre) ve aynı yükseklikte', () => {
    const { r } = setup();
    const box = r.getByTestId('inspection-meter-kutu');
    expect(within(box).getByText('m')).toBeOnTheScreen();
    expect(within(box).getByTestId('meter')).toBeOnTheScreen();
    const grid = r.getByTestId('inspection-type-grid');
    expect(within(grid).getByTestId('inspection-meter-kutu')).toBeTruthy();
    expect(within(grid).getByTestId('inspection-type-t-leke')).toBeTruthy();
    expect(StyleSheet.flatten(box.props.style).minHeight).toBe(64);
    expect(r.queryByText('Hata metresi (mt)')).toBeNull();
  });
  it('tip tanımsızken de metre kutusu çizilir', () => {
    const { r } = setup({ defectTypes: [] });
    expect(r.getByTestId('inspection-meter-kutu')).toBeOnTheScreen();
  });
});
