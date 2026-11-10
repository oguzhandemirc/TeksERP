import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import StationActionBar from './StationActionBar';
import type { StationAction } from './stationActionLayout';

let mockDims = { width: 480, height: 800, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
// AppModal kapanışı animasyon sonunda söker (jest'te bitmez): görünürlük sözleşmesini düz çiz.
jest.mock('../ModuleSheet', () => ({
  __esModule: true,
  default: (p: { visible: boolean; children: React.ReactNode; footer: React.ReactNode }) =>
    p.visible ? (
      <>
        {p.children}
        {p.footer}
      </>
    ) : null,
}));

// SimplePortal host'a bildirimi mikrotaskta düşer: her basıştan sonra bir tur akıt.
async function press(r: ReturnType<typeof renderWithPaper>, id: string) {
  fireEvent.press(r.getByTestId(id));
  await act(async () => {});
}

function build(over: Partial<Record<string, Partial<StationAction>>> = {}) {
  const spec: [string, string, number][] = [
    ['openJobs', 'Açık İşler · 2', 1],
    ['list', 'Açık Kartlar', 4],
    ['scan', 'Tara', 3],
    ['doc', 'Belge okut', 2],
    ['orderLink', 'Sipariş Bağla', 5],
    ['standalone', 'Serbest Etiket', 7],
    ['manual', 'Manuel Ekle', 6],
  ];
  return spec.map(([id, label, priority]) => ({
    id,
    label,
    icon: 'circle',
    priority,
    visible: true,
    onPress: jest.fn(),
    ...over[id],
  })) as (StationAction & { onPress: jest.Mock })[];
}

describe('StationActionBar', () => {
  beforeEach(() => {
    mockDims = { width: 480, height: 800, scale: 1, fontScale: 1 };
  });

  it('dar: 3 birincil tam etiketle + Diğer; gizliler yalnız menüde, birinciller menüde tekrar etmez', async () => {
    const actions = build();
    const r = renderWithPaper(<StationActionBar actions={actions} testIDPrefix="b" />);
    for (const id of ['openJobs', 'scan', 'doc']) expect(r.getByTestId(`b-${id}`)).toBeTruthy();
    for (const id of ['list', 'orderLink', 'standalone', 'manual']) expect(r.queryByTestId(`b-${id}`)).toBeNull();
    expect(r.getByText('Açık İşler · 2')).toBeTruthy();
    expect(r.queryByText('Serbest Etiket')).toBeNull();

    await press(r, 'b-more');
    for (const id of ['list', 'orderLink', 'standalone', 'manual']) expect(r.getByTestId(`b-menu-${id}`)).toBeTruthy();
    for (const id of ['openJobs', 'scan', 'doc']) expect(r.queryByTestId(`b-menu-${id}`)).toBeNull();
  });

  it('menüde seçim: onPress çalışır, menü kapanır', async () => {
    const actions = build();
    const r = renderWithPaper(<StationActionBar actions={actions} testIDPrefix="b" />);
    await press(r, 'b-more');
    await press(r, 'b-menu-standalone');
    expect(actions.find((a) => a.id === 'standalone')!.onPress).toHaveBeenCalledTimes(1);
    expect(r.queryByTestId('b-menu-standalone')).toBeNull();
  });

  it('Vazgeç: hiçbir eylem çalışmaz, menü kapanır', async () => {
    const actions = build();
    const r = renderWithPaper(<StationActionBar actions={actions} testIDPrefix="b" />);
    await press(r, 'b-more');
    await press(r, 'b-more-cancel');
    expect(r.queryByTestId('b-menu-list')).toBeNull();
    for (const a of actions) expect(a.onPress).not.toHaveBeenCalled();
  });

  it('birincil düğme basışı kendi onPress’ini çalıştırır', async () => {
    const actions = build();
    const r = renderWithPaper(<StationActionBar actions={actions} testIDPrefix="b" />);
    await press(r, 'b-doc');
    expect(actions.find((a) => a.id === 'doc')!.onPress).toHaveBeenCalledTimes(1);
  });

  it('geniş (800 dp): bugünkü düzen — hepsi satırda, Diğer yok', async () => {
    mockDims = { width: 800, height: 480, scale: 1, fontScale: 1 };
    const r = renderWithPaper(<StationActionBar actions={build()} testIDPrefix="b" />);
    for (const id of ['openJobs', 'list', 'scan', 'doc', 'orderLink', 'standalone', 'manual'])
      expect(r.getByTestId(`b-${id}`)).toBeTruthy();
    expect(r.queryByTestId('b-more')).toBeNull();
  });

  it('görünmez aksiyon hiçbir yerde yok (iki genişlik)', async () => {
    for (const width of [480, 800]) {
      mockDims = { width, height: 800, scale: 1, fontScale: 1 };
      const r = renderWithPaper(
        <StationActionBar actions={build({ manual: { visible: false }, orderLink: { visible: false } })} testIDPrefix="b" />,
      );
      expect(r.queryByTestId('b-manual')).toBeNull();
      expect(r.queryByTestId('b-orderLink')).toBeNull();
      if (r.queryByTestId('b-more')) {
        await press(r, 'b-more');
        expect(r.queryByTestId('b-menu-manual')).toBeNull();
        expect(r.queryByTestId('b-menu-orderLink')).toBeNull();
      }
      r.unmount();
    }
  });

  it('rozet: gizli aksiyonda varsa Diğer düğmesinde nokta, menü satırında sayı', async () => {
    const r = renderWithPaper(<StationActionBar actions={build({ list: { badge: 3 } })} testIDPrefix="b" />);
    expect(r.getByTestId('b-more-dot')).toBeTruthy();
    await press(r, 'b-more');
    expect(r.getByText('3')).toBeTruthy();
  });

  it('rozet birincildeyse düğmede sayı, Diğer’de nokta yok', async () => {
    const r = renderWithPaper(<StationActionBar actions={build({ openJobs: { badge: 5 } })} testIDPrefix="b" />);
    expect(r.getByText('5')).toBeTruthy();
    expect(r.queryByTestId('b-more-dot')).toBeNull();
  });
});
