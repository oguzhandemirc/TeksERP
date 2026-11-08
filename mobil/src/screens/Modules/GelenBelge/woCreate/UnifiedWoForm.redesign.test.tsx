// Tablet İE formu yeniden tasarım Dilim 1 (sağ sütun): "Üretim" başlığı yok; bölüm şeritleri; kilitli rotada adım yolu;
// hedef kumaş tek seçici düğmesi + belgedeki yazı; en/metraj aynı satırda birimli; makine çipleri ortak öneksiz ve seçili indigo.
// NEGATİF SONDA (ölçüldü): MachineBand'de önek ayıklaması kaldırılınca "kısa ad" testi KIRMIZI.
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { colors } from '../../../../theme';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import { StyleSheet } from 'react-native';
import { renderWithPaper } from '../../../../test/render';
import type { ProductionRoute } from '../../../../services/route.service';
import type { DocRow, ExtraFormBody } from './useWoRows';
import UnifiedWoForm from './UnifiedWoForm';

let mockRows: DocRow[] = [];
let mockOpts: { extraBody?: (r: DocRow) => ExtraFormBody } | undefined;
const mockSaveAll = jest.fn();
jest.mock('./useWoRows', () => ({
  useWoRows: (_r: unknown, opts: typeof mockOpts) => {
    mockOpts = opts;
    return {
      rows: mockRows,
      mode: 'WITH_WORK_ORDER',
      saving: false,
      counts: { ready: mockRows.filter((r) => r.form && !r.result).length },
      saveAll: mockSaveAll,
      removeRow: jest.fn(),
      addNote: jest.fn(),
      duplicate: null,
      dismissDuplicate: jest.fn(),
      confirmDuplicate: jest.fn(),
    };
  },
}));
// Sol sütun kartı yerine alt çubuktan gelen açma isteğini gösterir (isteğin seçiciyi açtığı DocRowCard.variant testinde).
jest.mock('./DocRowCard', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { openRequest?: { kind: string; seq: number } | null }) => <Text testID="mock-acma-istegi">{p.openRequest ? `${p.openRequest.kind}:${p.openRequest.seq}` : '-'}</Text>,
  };
});
jest.mock('../useDocScan', () => ({
  useDocScan: () => ({ pages: [], progress: { uploaded: new Set() }, sending: false, headerLocked: false, done: null, finish: jest.fn(), reset: jest.fn(), setPages: jest.fn(), capture: jest.fn(), captureMany: jest.fn(), send: jest.fn(), remaining: 0 }),
}));
jest.mock('../usePageSource', () => ({ usePageSource: () => ({ add: jest.fn(), busy: false, camera: { visible: false, capacity: 20, firstPageNo: 1, onDone: jest.fn(), onDismiss: jest.fn() } }) }));
jest.mock('../PageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../MultiPageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../PagePreviewModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: { tabletContext: async () => ({ data: { customers: [], kursunMachines: [{ id: 'm1', code: 'K1', name: 'KURŞUN MAKİNESİ 1', stationId: 'stK' }, { id: 'm10', code: 'K10', name: 'KURŞUN MAKİNESİ 10', stationId: 'stK' }] } }) },
}));
jest.mock('../../../../components/ModuleSheet', () => {
  const actual = jest.requireActual('../../../../components/ModuleSheet');
  return {
    ...actual,
    __esModule: true,
    default: (p: { visible: boolean; children: React.ReactNode; footer: React.ReactNode }) => (p.visible ? <>{p.children}{p.footer}</> : null),
  };
});
let mockBlob: Record<string, unknown> = {};
jest.mock('../../../../services/preferences.service', () => ({
  preferencesService: { get: async () => mockBlob, save: async (b: Record<string, unknown>) => (mockBlob = b) },
}));
// Seçici: görünürken her seçenek bir düğme (`secim-<başlık>-<değer>`).
jest.mock('../../../../components/PickerModal', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { visible: boolean; title: string; options: { value: string; label: string }[]; onSelect: (v: string) => void }) =>
      p.visible ? (
        <View>
          <Text testID={`secici-${p.title}`}>{p.title}</Text>
          {p.options.map((o) => (
            <Pressable key={o.value} onPress={() => p.onSelect(o.value)} testID={`secim-${p.title}-${o.value}`}>
              <Text>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null,
  };
});
jest.mock('../../../../services/fabricProperty.service', () => ({
  fabricPropertyService: { getAll: async () => ({ data: [{ id: 'p1', name: 'Yanmaz' }, { id: 'p2', name: 'Antibakteriyel' }] }) },
}));
// Rotanın varsayılan hedefleri: p1 (BAYRAK) + bir SEÇİM (tablet listesine girmez).
const mockDefaultsLoaded = () => new Map([['cu1', [{ stationId: 'stK', targets: [{ propertyId: 'p1', valueType: 'FLAG' }, { propertyId: 'pc', valueType: 'CHOICE' }] }]]]);
let mockDefaults: Map<string, unknown> = mockDefaultsLoaded();
jest.mock('../../../../hooks/useRouteDefaultTargets', () => ({ useRouteDefaultTargets: () => ({ byCustomer: mockDefaults }) }));
jest.mock('../../../../services/subcontractor.service', () => ({
  subcontractorService: { listSubcontractors: async () => ({ data: [{ id: 'f1', name: 'Boyacı A', categories: [{ categoryId: 'catB' }] }] }) },
}));
const station = (id: string, name: string, x: Record<string, unknown> = {}) => ({ id, name, kind: 'PROCESS', ...x });
const route = {
  id: 'r1',
  name: 'Kurşun → Boya',
  steps: [
    { id: 's1', stationId: 'stK', sequence: 1, station: station('stK', 'Kurşun', { isKursunStation: true }) },
    { id: 's2', stationId: 'stB', sequence: 2, requiredCategoryId: 'catB', station: station('stB', 'Boya', { defaultCategory: { id: 'catB', name: 'Boyahane' } }) },
  ],
} as unknown as ProductionRoute;
const other = { id: 'r2', name: 'Paket', steps: [{ id: 's9', stationId: 'stP', sequence: 1, station: station('stP', 'Paketleme') }] } as unknown as ProductionRoute;
jest.mock('../../../../services/route.service', () => ({ routeService: { getAll: async () => ({ data: [mockRoute, mockOther] }) } }));
const mockRoute = route;
const mockOther = other;
jest.mock('../../../../hooks/useFoldValues', () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));
jest.mock('../../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: true } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../../HizliIsEmri/OrderLinkPicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/ColorSelectField', () => ({ __esModule: true, default: () => null }));

const form = { ownerCustomerId: 'cu1', ownerSuggested: null, ourBatchNo: 'P-1', meters: 100, metersReview: false, multi: null };
const row = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, gramajTouched: false, result: null, form, detail: { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', formFields: { en: '150', hedefMetraj: '1200', desenText: 'DSN-7' }, suggestions: {} } } as unknown as DocRow;
const ui = () => renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
const bg = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) as { backgroundColor?: string }).backgroundColor;

beforeEach(() => {
  mockBlob = {};
  mockDefaults = mockDefaultsLoaded();
  mockRows = [row];
  mockOpts = undefined;
  jest.clearAllMocks();
});

describe('UnifiedWoForm — yeniden tasarım Dilim 1 (sağ sütun)', () => {
  it('⭐ "Üretim" başlığı yok; kilitli rotada adımlar tek yol satırında, editör ve rota seçici yok', async () => {
    const s = ui();
    expect(await s.findByTestId('ie-rota-yolu')).toHaveTextContent('Kurşun › Boya');
    expect(s.queryByText('Üretim')).toBeNull();
    expect(s.queryByTestId('ie-rota-adimlari')).toBeNull();
    expect(s.queryByTestId('ie-form-rota')).toBeNull();
    expect(s.queryByTestId('ie-serit-hedef')).toBeNull();
    expect(s.queryByTestId('ie-hedef-uyari')).toBeNull();
  });

  it('⭐ makine şeridi: "Makine seç", ortak önek şeritte, çipte kısa ad; seçilen çip indigo + selected, hap kısa adı söyler', async () => {
    const s = ui();
    const band = await s.findByTestId('ie-serit-makine');
    expect(band).toHaveTextContent(/Makine seç/);
    expect(band).toHaveTextContent(/KURŞUN MAKİNESİ/);
    expect(s.getByTestId('ie-serit-makine-durum')).toHaveTextContent(/Sonra$/);
    const chip = s.getByTestId('ie-form-makine-K10');
    expect(chip).toHaveTextContent(/^.?10$/);
    expect(chip.props.accessibilityLabel).toBe('KURŞUN MAKİNESİ 10');
    fireEvent.press(chip);
    await waitFor(() => expect(s.getByTestId('ie-form-makine-K10').props.accessibilityState).toMatchObject({ selected: true }));
    expect(bg(s.getByTestId('ie-form-makine-K10'))).toBe(colors.choice.onBg);
    expect(s.getByTestId('ie-form-makine-K1').props.accessibilityState).toMatchObject({ selected: false });
    expect(s.getByTestId('ie-serit-makine-durum')).toHaveTextContent(/^10$/);
    expect(mockOpts?.extraBody?.(mockRows[0])?.stepPlanning).toEqual([{ sequence: 1, plannedMachineId: 'm10' }]);
  });

  it('⭐ hedef kumaş tek seçici düğmesi: belgedeki yazı altında; basınca "Hedef kumaş" seçicisi açılır', async () => {
    const s = ui();
    const btn = await s.findByTestId('ie-form-hedef-kumas');
    expect(btn).toHaveTextContent(/Hedef kumaş seç/);
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-kumas')).toHaveTextContent(/Belgede: DSN-7/));
    expect(s.queryByTestId('secici-Hedef kumaş')).toBeNull();
    fireEvent.press(s.getByTestId('ie-form-hedef-kumas'));
    expect(s.getByTestId('secici-Hedef kumaş')).toBeTruthy();
  });

  it('⭐ en + metraj aynı satırda, birimler cm / m; belgeden gelen değer sarı vurgulu', async () => {
    const s = ui();
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    const nums = s.getByTestId('ie-hedef-sayilar');
    expect(nums).toContainElement(s.getByTestId('ie-form-en'));
    expect(nums).toContainElement(s.getByTestId('ie-form-hedef-metraj'));
    expect(s.getByTestId('ie-form-en-kutu')).toHaveTextContent(/En.*cm/);
    expect(s.getByTestId('ie-form-hedef-metraj-kutu')).toHaveTextContent(/Metraj.*m/);
    expect(bg(s.getByTestId('ie-form-en-kutu'))).toBe(DOC_HIGHLIGHT_BG);
    fireEvent.changeText(s.getByTestId('ie-form-en'), '160');
    expect(bg(s.getByTestId('ie-form-en-kutu'))).not.toBe(DOC_HIGHLIGHT_BG);
  });
});

describe('UnifiedWoForm — yeniden tasarım Dilim 2 (alt çubuk)', () => {
  const setRow = (f: Record<string, unknown>) => (mockRows = [{ ...row, form: { ...form, ...f } } as unknown as DocRow]);

  it('⭐ eksik yok → hap yok, "Hazır — kontrol edip oluşturun", Oluştur etkin', async () => {
    const s = ui();
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.queryByTestId('ie-eksik-musteri')).toBeNull();
    expect(s.queryByTestId('ie-eksik-fazla')).toBeNull();
    expect(s.getByTestId('ie-form-ipucu')).toHaveTextContent('Hazır — kontrol edip oluşturun');
    expect(s.getByTestId('ie-form-olustur').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('⭐ müşteri boş → "Müşteri seçilmedi" hapı, Oluştur kapalı; hapa dokununca müşteri seçicisi isteği karta gider', async () => {
    setRow({ ownerCustomerId: null });
    const s = ui();
    expect(await s.findByTestId('ie-eksik-musteri')).toHaveTextContent(/Müşteri seçilmedi/);
    expect(s.getByTestId('ie-form-ipucu')).toHaveTextContent('Müşteriyi seçin.');
    expect(s.getByTestId('ie-form-olustur').props.accessibilityState).toMatchObject({ disabled: true });
    expect(s.getByTestId('mock-acma-istegi')).toHaveTextContent('-');
    fireEvent.press(s.getByTestId('ie-eksik-musteri'));
    expect(s.getByTestId('mock-acma-istegi')).toHaveTextContent('owner:1');
  });

  it('⭐ metre yok → "Metre yok" hapı metre sayfası isteği açar', async () => {
    setRow({ meters: null });
    const s = ui();
    fireEvent.press(await s.findByTestId('ie-eksik-kursunMetresi'));
    expect(s.getByTestId('mock-acma-istegi')).toHaveTextContent('meter:1');
  });

  it('⭐ dört eksik → ilk üçü hap, kalan "+1"; sayı hatası tek satır Hedef uyarısı çıkarır', async () => {
    setRow({ ownerCustomerId: null, meters: null });
    const s = ui();
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.queryByTestId('ie-hedef-uyari')).toBeNull();
    fireEvent.changeText(s.getByTestId('ie-form-en'), '0');
    fireEvent.changeText(s.getByTestId('ie-form-hedef-metraj'), '0');
    expect(s.getByTestId('ie-eksik-musteri')).toBeTruthy();
    expect(s.getByTestId('ie-eksik-kursunMetresi')).toBeTruthy();
    expect(s.getByTestId('ie-eksik-en')).toHaveTextContent(/En hatalı/);
    expect(s.queryByTestId('ie-eksik-hedefMetraj')).toBeNull();
    expect(s.getByTestId('ie-eksik-fazla')).toHaveTextContent('+1');
    expect(s.getByTestId('ie-hedef-uyari')).toHaveTextContent(/Sayıyı düzeltin/);
  });
});
