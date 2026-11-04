// S16b tek form: belge okutulmadan "oluştur" kapalı; okuma sonucu inputlara dolar (belgeden sarı vurgu); desen/renk önerisi
// çiple onaylanır; kayıt form ucuna ek alanlarla gider, PER_PARTY'de hedef metraj/kg gitmez.
import React from 'react';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { renderWithPaper } from '../../../../test/render';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import type { ProductionRoute } from '../../../../services/route.service';
import type { DocRow, ExtraFormBody } from './useWoRows';
import UnifiedWoForm from './UnifiedWoForm';

let mockDims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
let mockRows: DocRow[] = [];
let mockOpts: { extraBody?: (r: DocRow) => ExtraFormBody } | undefined;
const mockSaveAll = jest.fn();
const mockAdd = jest.fn();
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
jest.mock('./DocRowCard', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { row: DocRow }) => <Text testID="satir-karti">{p.row.noteNo}</Text> };
});
jest.mock('../useDocScan', () => ({
  useDocScan: () => ({ pages: [], progress: { uploaded: new Set() }, sending: false, headerLocked: false, done: null, finish: jest.fn(), reset: jest.fn(), setPages: jest.fn(), capture: jest.fn(), captureMany: jest.fn(), send: jest.fn(), remaining: 0 }),
}));
jest.mock('../usePageSource', () => ({ usePageSource: () => ({ add: () => mockAdd(), busy: false, camera: { visible: false, capacity: 20, firstPageNo: 1, onDone: jest.fn(), onDismiss: jest.fn() } }) }));
jest.mock('../PageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../MultiPageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../PagePreviewModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../services/inboundDoc.service', () => ({ inboundDocService: { tabletContext: async () => ({ data: { customers: [] } }) } }));
// Kart iskeleti (kendi bekçisi ModuleSheet.test): görünürken içerik + alt düğmeler düz çizilir.
jest.mock('../../../../components/ModuleSheet', () => {
  const actual = jest.requireActual('../../../../components/ModuleSheet');
  return {
    ...actual,
    __esModule: true,
    default: (p: { visible: boolean; children: React.ReactNode; footer: React.ReactNode }) => (p.visible ? <>{p.children}{p.footer}</> : null),
  };
});
// K30-D kişisel tercih blob'u: bellek içi; panelin anahtarı (`theme`) her yazımda korunmalı.
let mockBlob: Record<string, unknown> = {};
const mockPrefSave = jest.fn(async (b: Record<string, unknown>) => {
  mockBlob = b;
  return b;
});
jest.mock('../../../../services/preferences.service', () => ({
  preferencesService: { get: async () => mockBlob, save: (b: Record<string, unknown>) => mockPrefSave(b) },
}));
jest.mock('../../../../services/route.service', () => ({ routeService: { getAll: async () => ({ data: [] }) } }));
jest.mock('../../../../hooks/useFoldValues', () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));
let mockQty = false;
jest.mock('../../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: mockQty } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../../HizliIsEmri/OrderLinkPicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/ColorSelectField', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string | null }) => <Text testID="renk-alani">{p.value ?? 'bos'}</Text> };
});

const route = { id: 'r1', name: 'Kurşun&Tambur', steps: [] } as unknown as ProductionRoute;
const form = { ownerCustomerId: 'cu1', ownerSuggested: null, ourBatchNo: 'P-1', meters: 100, metersReview: false, multi: null };
const row = (x: Partial<DocRow> = {}): DocRow =>
  ({
    noteId: 'n1',
    noteNo: 'GB-1',
    runKey: 1,
    gramajTouched: false,
    result: null,
    form,
    detail: {
      id: 'n1',
      noteNo: 'GB-1',
      status: 'DRAFT',
      formFields: { en: '150', hedefMetraj: '1.200,5', hedefKg: 300, desenText: 'DSN-7', renkText: 'Ekru' },
      suggestions: { targetItem: { id: 'i1', name: 'Tül Beyaz', code: 'T-1' }, targetColor: { id: 'c1', name: 'Ekru' } },
    },
    ...x,
  }) as unknown as DocRow;

const ui = (r: ProductionRoute | null = route) => <UnifiedWoForm initialRoute={r} routeLocked={r !== null} onNew={jest.fn()} />;

beforeEach(() => {
  mockBlob = { theme: 'dark' };
  mockRows = [];
  mockOpts = undefined;
  mockQty = false;
  mockDims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
  jest.clearAllMocks();
});

/** testID'li öğe ya da atalarından biri belgeden vurgusunda mı (Paper girdisinin stili sarmalayıcıya iner). */
function highlighted(s: ReturnType<typeof renderWithPaper>, testID: string): boolean {
  type N = { props: { style?: unknown }; parent: N | null };
  let n: N | null = s.getByTestId(testID) as unknown as N;
  while (n) {
    if ((StyleSheet.flatten(n.props.style as never) as { backgroundColor?: unknown } | undefined)?.backgroundColor === DOC_HIGHLIGHT_BG) return true;
    n = n.parent;
  }
  return false;
}

describe('UnifiedWoForm', () => {
  it('⭐ belge okutulmadan "oluştur" KAPALI + ipucu; belge alanları yer tutucu; Belge okut tarayıcıyı açar', () => {
    const s = renderWithPaper(ui());
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    expect(s.getByTestId('ie-form-ipucu').props.children).toMatch(/Belge okut/);
    expect(s.getByTestId('ie-form-belge-yer-tutucu')).toBeTruthy();
    expect(s.getByTestId('ie-form-en').props.value).toBe('');
    fireEvent.press(s.getByTestId('ie-belge-okut'));
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('⭐ okuma sonucu inputlara dolar + "belgeden" rozeti; metraj/kg bayrak kapalıyken de belgeden geldiği için görünür', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.getByTestId('belgeden-width')).toBeTruthy();
    expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('1200.5');
    expect(s.getByTestId('ie-form-hedef-kg').props.value).toBe('300');
    expect(s.getByTestId('belgeden-targetQuantity')).toBeTruthy();
    expect(s.getByTestId('satir-karti')).toBeTruthy();
    expect(s.getByText('Belgeyi değiştir')).toBeTruthy();
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
  });

  it('⭐ belgeden dolan En sarı vurgulu, rozet yazısı yok; elle değişince vurgu kalkar', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(highlighted(s, 'ie-form-en')).toBe(true);
    expect(highlighted(s, 'ie-form-hedef-kg')).toBe(true);
    expect(s.queryByText('belgeden')).toBeNull();
    fireEvent.changeText(s.getByTestId('ie-form-en'), '160');
    expect(s.queryByTestId('belgeden-width')).toBeNull();
    expect(highlighted(s, 'ie-form-en')).toBe(false);
    expect(highlighted(s, 'ie-form-hedef-kg')).toBe(true);
  });

  it('⭐ tablet yatay (1280×800): iki sütun — solda belge okut + belge kartı, sağda üretim alanları; dikeyde tek sütun', async () => {
    mockRows = [row()];
    mockDims = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    const left = within(s.getByTestId('ie-form-sol'));
    const right = within(s.getByTestId('ie-form-sag'));
    expect(left.getByTestId('ie-belge-okut')).toBeTruthy();
    expect(left.getByTestId('satir-karti')).toBeTruthy();
    expect(right.getByTestId('ie-form-en')).toBeTruthy();
    expect(left.queryByTestId('ie-form-en')).toBeNull();
    mockDims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
    const d = renderWithPaper(ui());
    expect(d.queryByTestId('ie-form-iki-sutun')).toBeNull();
  });

  it('⭐ kontrollü Alanlar: fieldsOpen verilince gövde tuşu çizilmez, seçici prop ile açılır', () => {
    const onChange = jest.fn();
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} fieldsOpen={false} onFieldsOpenChange={onChange} />);
    expect(s.queryByTestId('ie-alanlar')).toBeNull();
    expect(s.queryByText('Varsayılana dön')).toBeNull();
    const o = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} fieldsOpen onFieldsOpenChange={onChange} />);
    expect(o.getByText('Varsayılana dön')).toBeTruthy();
  });

  it('⭐ öneri çipi: "Evet" → hedef kumaş / renk seçili, çip kalkar; öneri alana kendiliğinden yazılmaz', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui());
    const chip = await s.findByTestId('ie-form-desen-oneri');
    expect(chip).toHaveTextContent(/DSN-7.*Tül Beyaz \(T-1\) mi\? Evet/);
    expect(s.getByTestId('renk-alani').props.children).toBe('bos');
    fireEvent.press(chip);
    fireEvent.press(s.getByTestId('ie-form-renk-oneri'));
    expect(s.queryByTestId('ie-form-desen-oneri')).toBeNull();
    expect(s.queryByTestId('ie-form-renk-oneri')).toBeNull();
    expect(s.getByTestId('renk-alani').props.children).toBe('c1');
    expect(s.getByText('Tül Beyaz')).toBeTruthy();
  });

  it('⭐ kayıt: ek alanlar form ucunun gövdesine; PER_PARTY satırda hedef metraj/kg GİTMEZ', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui());
    fireEvent.press(await s.findByTestId('ie-form-desen-oneri'));
    fireEvent.changeText(s.getByTestId('ie-form-en'), '160');
    fireEvent.press(s.getByTestId('ie-form-olustur'));
    expect(mockSaveAll).toHaveBeenCalledTimes(1);
    expect(mockOpts?.extraBody?.(mockRows[0])).toEqual({ targetItemId: 'i1', width: 160, targetQuantity: 1200.5, targetWeight: 300 });
    const perParty = row({ form: { ...form, multi: { mode: 'PER_PARTY', rows: [] } } } as unknown as Partial<DocRow>);
    const b = mockOpts?.extraBody?.(perParty);
    expect(b).not.toHaveProperty('targetQuantity');
    expect(b).not.toHaveProperty('targetWeight');
    expect(b).toMatchObject({ width: 160 });
  });

  it('⭐ hedef metraj ayarı açık + belgede hedef yok → gelen metre "gelen metreden" rozetiyle; yazınca rozet kalkar, değer gövdeye gider', async () => {
    mockQty = true;
    const base = row();
    mockRows = [row({ detail: { ...base.detail, formFields: { en: '150' } } } as unknown as Partial<DocRow>)];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('100'));
    expect(s.getByTestId('gelen-metreden-targetQuantity')).toBeTruthy();
    expect(mockOpts?.extraBody?.(mockRows[0])).not.toHaveProperty('targetQuantity');
    fireEvent.changeText(s.getByTestId('ie-form-hedef-metraj'), '90');
    expect(s.queryByTestId('gelen-metreden-targetQuantity')).toBeNull();
    expect(mockOpts?.extraBody?.(mockRows[0])).toMatchObject({ targetQuantity: 90 });
  });

  it('⭐ toplar ayrı geldi: hedef metraj gelen metresi top toplamı', async () => {
    mockQty = true;
    const base = row();
    const rolls = [{ key: 'a', meters: 40, weightKg: null, senderRollNo: '' }, { key: 'b', meters: 60.5, weightKg: null, senderRollNo: '' }];
    mockRows = [row({ form: { ...form, rolls }, detail: { ...base.detail, formFields: {} } } as unknown as Partial<DocRow>)];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('100.5'));
    expect(s.getByTestId('gelen-metreden-targetQuantity')).toBeTruthy();
  });

  it('düz karo (rota seçilmedi): belge okunsa da "Rotayı seçin." ile kapalı', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui(null));
    await waitFor(() => expect(s.getByTestId('ie-form-ipucu').props.children).toBe('Rotayı seçin.'));
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
  });
});

describe('UnifiedWoForm — ⚙ Alanlar (K30-D)', () => {
  const openSheet = async (s: ReturnType<typeof renderWithPaper>) => {
    fireEvent.press(s.getByTestId('ie-alanlar'));
    return s.findByTestId('ie-alan-en');
  };

  it('⭐ kapat → alan "Diğer alanlar (n)"e iner → dokununca açılır → geri aç → üste döner; blob diğer anahtarları korur', async () => {
    const s = renderWithPaper(ui());
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    fireEvent.press(await openSheet(s));
    fireEvent.press(s.getByTestId('ie-alanlar-tamam'));
    await waitFor(() => expect(mockPrefSave).toHaveBeenCalledTimes(1));
    expect(mockPrefSave.mock.calls[0][0]).toEqual({ theme: 'dark', tabletIeForm: { gizli: ['en'] } });
    expect(s.queryByTestId('ie-form-en')).toBeNull();
    expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (1)');
    fireEvent.press(s.getByTestId('ie-diger-alanlar'));
    expect(s.getByTestId('ie-form-alanlari-diger')).toContainElement(s.getByTestId('ie-form-en'));
    fireEvent.press(await openSheet(s));
    await waitFor(() => expect(mockPrefSave).toHaveBeenCalledTimes(2));
    expect(mockBlob).toEqual({ theme: 'dark', tabletIeForm: { gizli: [] } });
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    expect(s.getByTestId('ie-form-alanlari')).toContainElement(s.getByTestId('ie-form-en'));
  });

  it('⭐ zorunlular kapatılamaz ("zorunlu" etiketi, anahtar pasif); Varsayılana dön hepsini açar', async () => {
    mockBlob = { theme: 'dark', tabletIeForm: { gizli: ['not', 'planBaslangic', 'rota', 'bilinmeyen'] } };
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (2)'));
    expect(s.getByText('Rota')).toBeTruthy();
    await openSheet(s);
    for (const k of ['musteri', 'partiNo', 'kursunMetresi', 'rota']) {
      expect(s.getByTestId(`ie-alan-zorunlu-${k}`)).toBeTruthy();
      expect(s.getByTestId(`ie-alan-anahtar-${k}`)).toBeDisabled();
    }
    expect(s.getByTestId('ie-alan-hedefOzellik')).toBeTruthy();
    fireEvent.press(s.getByTestId('ie-alan-rota'));
    expect(mockPrefSave).not.toHaveBeenCalled();
    fireEvent.press(s.getByTestId('ie-alanlar-varsayilan'));
    await waitFor(() => expect(mockBlob).toEqual({ theme: 'dark', tabletIeForm: { gizli: [] } }));
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    expect(s.getByTestId('ie-form-not')).toBeTruthy();
  });

  it('⭐ gizli alanı belge doldurursa bu okumada üstte "belgeden" rozetiyle görünür (sessiz gönderim yok)', async () => {
    mockBlob = { tabletIeForm: { gizli: ['en', 'hedefKumas', 'planBitis'] } };
    mockRows = [row()];
    const s = renderWithPaper(ui());
    // Tercih yüklendi: yalnız belgenin doldurmadığı gizli alan (Planlı bitiş) altta kalır.
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (1)'));
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.getByTestId('ie-form-alanlari')).toContainElement(s.getByTestId('ie-form-en'));
    expect(s.getByTestId('belgeden-width')).toBeTruthy();
    expect(s.getByTestId('ie-form-alanlari')).toContainElement(s.getByTestId('ie-form-desen-oneri'));
  });

  it('⭐ belgeden üste çıkan gizli alan düzeltilince yerinde kalır (rozet düşer, değer gövdeye gider)', async () => {
    mockBlob = { tabletIeForm: { gizli: ['en'] } };
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    fireEvent.changeText(s.getByTestId('ie-form-en'), '170');
    expect(s.queryByTestId('belgeden-width')).toBeNull();
    expect(s.getByTestId('ie-form-alanlari')).toContainElement(s.getByTestId('ie-form-en'));
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    expect(mockOpts?.extraBody?.(mockRows[0])).toMatchObject({ width: 170 });
  });

  it('tercih okunamazsa hepsi açık; yazılamayan seçim yerelde kalır ve "kaydedilecek" ipucu görünür', async () => {
    mockBlob = null as unknown as Record<string, unknown>;
    mockPrefSave.mockRejectedValueOnce(new Error('ağ yok'));
    const s = renderWithPaper(ui());
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    fireEvent.press(await openSheet(s));
    await waitFor(() => expect(s.getByTestId('ie-alanlar-bekliyor')).toBeTruthy());
    expect(s.queryByTestId('ie-form-en')).toBeNull();
  });
});
