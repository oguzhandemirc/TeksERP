// El terminali (~384dp) İE listesi: arama 🔍 düğmesine iner (dokununca aynı satırda açılır, metin varken ikon vurgulu), süzgeçler
// tek satır kompakt çip (Tarih ilk üçte), alt eylem bloğu tek ince şerit (iki tuş yan yana), kart 3 satır ve tekrar eden
// "İptal" konum yazısı yok. Tablet (800dp) yerleşimi değişmez.
// Negatif sonda: `hooks/useDeviceType.isCompactWidth` hep false → bu dosyanın dar vakaları kırmızı.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import FilterBar from './FilterBar';
import ActionBar from './ActionBar';
import WorkOrderTable from './WorkOrderTable';
import { DEFAULT_VISIBLE } from './columns';
import { DEFAULT_FILTERS, type ListFilters, type WorkOrderListRow } from './workOrderRow';
import type { ProductionRoute } from '../../../services/route.service';

let mockDims = { width: 384, height: 640, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('@shopify/flash-list', () => {
  const { View } = jest.requireActual('react-native');
  return {
    FlashList: (props: { data: unknown[]; renderItem: (a: { item: unknown; index: number }) => React.ReactNode }) => (
      <View>{props.data.map((item, index) => <View key={index}>{props.renderItem({ item, index })}</View>)}</View>
    ),
  };
});

const TABLET = { width: 800, height: 1280, scale: 1, fontScale: 1 };
beforeEach(() => { mockDims = { width: 384, height: 640, scale: 1, fontScale: 1 }; });

function Filters({ initial = DEFAULT_FILTERS }: { initial?: ListFilters }) {
  const [v, setV] = useState(initial);
  return <FilterBar value={v} onChange={setV} stations={[]} stationsLoading={false} searching={false} onColumns={jest.fn()} onOptions={jest.fn()} />;
}

describe('FilterBar — dar ekran', () => {
  it('⭐ arama kutusu yok, 🔍 düğmesi var; dokununca açılır, kapatınca ikona döner', () => {
    const ui = renderWithPaper(<Filters />);
    expect(ui.queryByTestId('ie-liste-arama')).toBeNull();
    fireEvent.press(ui.getByTestId('ie-liste-arama-ac'));
    expect(ui.getByTestId('ie-liste-arama')).toBeTruthy();
    expect(ui.queryByTestId('ie-liste-durum')).toBeNull();
    fireEvent.press(ui.getByTestId('ie-liste-arama-kapat'));
    expect(ui.queryByTestId('ie-liste-arama')).toBeNull();
    expect(ui.queryByTestId('ie-liste-arama-etkin')).toBeNull();
  });

  it('⭐ aktif arama metni varken kapalı ikon vurgulu', () => {
    const ui = renderWithPaper(<Filters initial={{ ...DEFAULT_FILTERS, search: 'IE-12' }} />);
    expect(ui.getByTestId('ie-liste-arama-etkin')).toBeTruthy();
    expect(ui.getByTestId('ie-liste-arama-ac').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('⭐ çipler tek satır: başlık yazısı yok, kısa değer; sıra Durum → Tarih → Nerede', () => {
    const ui = renderWithPaper(<Filters />);
    expect(ui.queryByText('Açılış tarihi')).toBeNull();
    expect(ui.queryByText('Şu an nerede')).toBeNull();
    expect(within(ui.getByTestId('ie-liste-tarih')).getByText('Tarih')).toBeTruthy();
    expect(within(ui.getByTestId('ie-liste-istasyon')).getByText('Nerede')).toBeTruthy();
    const ids = ui.getAllByTestId(/^ie-liste-(durum|tarih|istasyon)$/).map((n) => n.props.testID);
    expect(ids).toEqual(['ie-liste-durum', 'ie-liste-tarih', 'ie-liste-istasyon']);
  });

  it('tablet: arama kutusu doğrudan, iki satırlı etiketli düğmeler', () => {
    mockDims = TABLET;
    const ui = renderWithPaper(<Filters />);
    expect(ui.getByTestId('ie-liste-arama')).toBeTruthy();
    expect(ui.queryByTestId('ie-liste-arama-ac')).toBeNull();
    expect(ui.getByText('Açılış tarihi')).toBeTruthy();
  });
});

const route = { id: 'r1', name: 'Kurşun&Tambur', steps: [] } as unknown as ProductionRoute;
const bar = () => renderWithPaper(
  <ActionBar groups={{ special: [], ready: [route] }} type={route} loading={false} onSelect={jest.fn()} showRoute onScan={jest.fn()} onManual={jest.fn()} buttons="both" kindTag={{ label: 'Fason', fason: true }} />,
);

describe('ActionBar — dar ekran', () => {
  it('⭐ tek ince şerit: iki tuş yan yana, rota tuşun alt yazısı + ayrı ▾ bölgesi', () => {
    const ui = bar();
    const strip = ui.getByTestId('ie-eylem-dar');
    const row = strip.children[0] as unknown as { props: { style: unknown } };
    expect(StyleSheet.flatten(row.props.style as never)).toMatchObject({ flexDirection: 'row' });
    expect(within(strip).getByTestId('ie-okut')).toBeTruthy();
    expect(within(strip).getByTestId('ie-elle-olustur')).toBeTruthy();
    expect(within(strip).getByTestId('ie-tur-sec')).toBeTruthy();
    expect(within(ui.getByTestId('ie-okut')).getByText('Kurşun&Tambur')).toBeTruthy();
    // "Rota: …" ayrı bant satırı yok; tür rozeti bir kez (küçük).
    expect(ui.queryByText(/^Rota: /)).toBeNull();
    expect(ui.getAllByText('Fason')).toHaveLength(1);
  });

  it('tablet: bugünkü iki büyük tuş + "Rota: …" bandı', () => {
    mockDims = TABLET;
    const ui = bar();
    expect(ui.queryByTestId('ie-eylem-dar')).toBeNull();
    expect(ui.getByText(/^Rota: Kurşun&Tambur/)).toBeTruthy();
  });
});

const rows: WorkOrderListRow[] = [
  {
    id: 'w1', workOrderNumber: 'IE-0001', status: 'IN_PROGRESS', type: 'CUSTOMER_GOODS_SERVICE', createdAt: '2026-11-06T13:00:00Z',
    customers: [{ id: 'c1', name: 'HHL Tekstil' }], targetItem: { name: 'Tül' }, targetColor: { name: 'Ekru' },
    konum: { sinif: 'TEK_ISTASYON', canliTop: 4, istasyonlar: [{ istasyonId: 's1', ad: 'Ram', tur: 'RAM', dis: false, topSayisi: 4, metre: 400, fasondaTop: 0, fasoncular: [] }] },
  },
  { id: 'w2', workOrderNumber: 'IE-0002', status: 'CANCELLED', createdAt: '2026-11-06T13:00:00Z', konum: { sinif: 'BITTI', canliTop: 0, istasyonlar: [] } },
];
const table = () => renderWithPaper(
  <WorkOrderTable rows={rows} visible={[...DEFAULT_VISIBLE]} loading={false} problem={null} empty={{ title: '', text: '', action: null }} refreshing={false} fetchingMore={false}
    onEndReached={jest.fn()} onRefresh={jest.fn()} onRetry={jest.fn()} onOpen={jest.fn()} onEmptyAction={jest.fn()} />,
);

describe('WorkOrderTable — dar ekran kartı', () => {
  it('⭐ 3 satır: no + durum · müşteri + tür rozeti · kumaş/renk + top', () => {
    const ui = table();
    const l1 = within(ui.getByTestId('ie-kart-satir1-w1'));
    expect(l1.getByText('IE-0001')).toBeTruthy();
    expect(l1.getByTestId('ie-konum-dar-w1')).toBeTruthy();
    const l2 = within(ui.getByTestId('ie-kart-satir2-w1'));
    expect(l2.getByText('HHL Tekstil')).toBeTruthy();
    expect(l2.getByTestId('ie-tur-rozet-w1')).toHaveTextContent('Fason');
    const l3 = within(ui.getByTestId('ie-kart-satir3-w1'));
    expect(l3.getByText('Tül · Ekru')).toBeTruthy();
    expect(l3.getByTestId('ie-top-w1')).toHaveTextContent('4 top');
    // Etiketli "Müşteri" / "Kumaş / renk" satırları yok.
    expect(ui.queryByText('Müşteri')).toBeNull();
  });

  it('⭐ iptal İE: durum sağ üstte bir kez, büyük "İptal" konum yazısı tekrar etmez', () => {
    const ui = table();
    const card = within(ui.getByTestId('ie-kart-dar-w2'));
    expect(card.getAllByText(/^İptal/)).toHaveLength(1);
    expect(card.queryByTestId('ie-konum-dar-w2')).toBeNull();
  });

  it('600–720dp ve tablet kartı değişmez (dar kart yok)', () => {
    mockDims = TABLET;
    const ui = table();
    expect(ui.queryByTestId('ie-kart-dar-w1')).toBeNull();
    act(() => undefined);
  });
});
