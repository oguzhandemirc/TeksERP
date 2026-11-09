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
import { SCAN_ROUTE } from './woFromDoc';
// Kendi üretim kipinin top okutma kancası ses/titreşim katmanını çeker (expo-audio jest'te yüklenmez).
jest.mock('../../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));

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
  // Tek form kipi + "Yeniden okut" bağı görünsün: kart metnine kip, basışa onReread.
  return { __esModule: true, default: (p: { row: DocRow; variant?: string; onReread?: () => void }) => <Text testID="satir-karti" onPress={p.onReread}>{`${p.row.noteNo} ${p.variant ?? 'list'}`}</Text> };
});
const PAGE = { base64: '', sha256: 's1', uri: 'file:///1.jpg', width: 10, height: 10 };
let mockScan: { pages: typeof PAGE[]; sending: boolean; headerLocked: boolean; uploaded: Set<string> } = { pages: [], sending: false, headerLocked: false, uploaded: new Set() };
jest.mock('../useDocScan', () => ({
  useDocScan: () => ({ pages: mockScan.pages, progress: { note: null, uploaded: mockScan.uploaded }, sending: mockScan.sending, headerLocked: mockScan.headerLocked, done: null, finish: jest.fn(), reset: jest.fn(), setPages: jest.fn(), capture: jest.fn(), captureMany: jest.fn(), send: jest.fn(), remaining: mockScan.pages.length }),
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
jest.mock('../../../../services/route.service', () => ({ routeService: { getActive: async () => ({ data: [] }) } }));
jest.mock('../../../../hooks/useFoldValues', () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));
let mockQty = false;
let mockWidth: boolean | undefined;
jest.mock('../../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: mockQty, targetWidthEnabled: mockWidth } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../../HizliIsEmri/OrderLinkPicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/ColorSelectField', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string | null }) => <Text testID="renk-alani">{p.value ?? 'bos'}</Text> };
});

const route = { id: 'r1', name: 'Kurşun&Tambur', steps: [] } as unknown as ProductionRoute;
// Renk veren (boyahane) adımı olan rota: hedef renk sorusu görünür.
const colorRoute = { id: 'r2', name: 'Boya', steps: [{ id: 's1', stationId: 'st1', sequence: 1, station: { id: 'st1', name: 'Boya', appliesColor: true } }] } as unknown as ProductionRoute;
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

/** ⚙ "Belgedeki gelen değerleri hedefe yaz" açık (varsayılan kapalı; kopyalama davranışı bu anahtarla). */
const fillOn = () => {
  const cur = (mockBlob?.tabletIeForm ?? {}) as Record<string, unknown>;
  mockBlob = { ...mockBlob, tabletIeForm: { ...cur, hedefDoldur: true } };
};

beforeEach(() => {
  mockBlob = { theme: 'dark' };
  mockRows = [];
  mockOpts = undefined;
  mockQty = false;
  mockWidth = undefined;
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

// Canlı kamera "Çek ve bitir" (2026-11-09): gönderim sürerken sayfa listesi/gönder paneli çizilmez, tek kompakt "Belge okunuyor…";
// gönderim düşünce (sayfalar bekliyor) bugünkü yeniden dene / vazgeç paneli. Negatif sonda: DocColumn'da `sending` dalı
// kaldırılınca ilk vaka kırmızı.
describe('UnifiedWoForm — belge gönderilirken', () => {
  afterEach(() => { mockScan = { pages: [], sending: false, headerLocked: false, uploaded: new Set() }; });
  it('⭐ gönderim sürerken yalnız "Belge okunuyor…" (sayfa listesi, Vazgeç, gönder düğmesi yok)', () => {
    mockScan = { pages: [PAGE], sending: true, headerLocked: false, uploaded: new Set() };
    const s = renderWithPaper(ui());
    expect(s.getByTestId('ie-belge-okunuyor')).toHaveTextContent(/Belge okunuyor/);
    expect(s.queryByText(/Sayfalar \(/)).toBeNull();
    expect(s.queryByTestId('belge-ie-gonder')).toBeNull();
    expect(s.queryByText('Vazgeç')).toBeNull();
    expect(s.queryByTestId('ie-belge-okut')).toBeNull();
  });
  it('⭐ gönderim düştüyse bekleyen sayfalar + "Yeniden dene" / Vazgeç paneli kalır', () => {
    mockScan = { pages: [PAGE], sending: false, headerLocked: true, uploaded: new Set() };
    const s = renderWithPaper(ui());
    expect(s.queryByTestId('ie-belge-okunuyor')).toBeNull();
    expect(s.getByTestId('belge-ie-gonder')).toHaveTextContent(/Yeniden dene \(1 sayfa\)/);
    expect(s.getByText('Vazgeç')).toBeTruthy();
  });
});

describe('UnifiedWoForm', () => {
  it('⭐ belge okutulmadan "oluştur" KAPALI + ipucu; belge alanları yer tutucu; Belge okut tarayıcıyı açar', () => {
    const s = renderWithPaper(ui());
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    expect(s.getByTestId('ie-form-ipucu').props.children).toMatch(/Önce belgeyi okutun/);
    expect(s.getByTestId('ie-form-belge-yer-tutucu')).toBeTruthy();
    expect(s.getByTestId('ie-form-en').props.value).toBe('');
    fireEvent.press(s.getByTestId('ie-belge-okut'));
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('⭐ okuma sonucu inputlara dolar + "belgeden" rozeti; metraj/kg bayrak kapalıyken de belgeden geldiği için görünür', async () => {
    fillOn();
    mockQty = true;
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.getByTestId('belgeden-width')).toBeTruthy();
    expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('1200.5');
    expect(s.getByTestId('ie-form-hedef-kg').props.value).toBe('300');
    // T2: formdaki kg HEDEF kg'dir (gelen kg belge satırının kutusunda).
    expect(s.getByTestId('ie-form-hedef-kg').props.accessibilityLabel).toBe('Hedef kg (kg)');
    expect(s.getByTestId('belgeden-targetQuantity')).toBeTruthy();
    expect(s.getByTestId('satir-karti')).toHaveTextContent(/single/);
    // Belge varken dev "Belgeyi okut" düğmesi yok; yeniden okutma kartın Belge şeridinde.
    expect(s.queryByTestId('ie-belge-okut')).toBeNull();
    expect(s.queryByText('Belgeyi değiştir')).toBeNull();
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
  });

  it('⭐ varsayılan (⚙ anahtarı kapalı): belge hedef kutularına KOPYALANMAZ — kutu boş, silik ipucu "belgede …"; not yine dolar', async () => {
    mockQty = true;
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-metraj').props.placeholder).toBe('belgede 1200,5 m'));
    expect(s.getByTestId('ie-form-en').props.value).toBe('');
    expect(s.getByTestId('ie-form-en').props.placeholder).toBe('belgede 150 cm');
    expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('');
    expect(s.getByTestId('ie-form-hedef-kg').props.placeholder).toBe('belgede 300 kg');
    expect(s.queryByTestId('belgeden-width')).toBeNull();
    expect(s.queryByTestId('gelen-metreden-targetQuantity')).toBeNull();
    expect(mockOpts?.extraBody?.(mockRows[0])).not.toHaveProperty('width');
  });

  it('⭐ ⚙ "Belgedeki gelen değerleri hedefe yaz" anahtarı açılır → tercih blob\'una yazılır, hedef kutuları dolar', async () => {
    mockQty = true;
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.placeholder).toBe('belgede 150 cm'));
    fireEvent.press(s.getByTestId('ie-alanlar'));
    fireEvent.press(s.getByTestId('ie-hedef-doldur'));
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(mockPrefSave.mock.calls[0][0]).toMatchObject({ theme: 'dark', tabletIeForm: { gizli: [], hedefDoldur: true } });
  });

  it('⭐ hedef metraj/kg ayarı KAPALI: belge değer getirse de kutu çizilmez, gövdeye gitmez (anahtar açık olsa da)', async () => {
    mockBlob = { tabletIeForm: { hedefDoldur: true } };
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.queryByTestId('ie-form-hedef-metraj')).toBeNull();
    expect(s.queryByTestId('ie-form-hedef-kg')).toBeNull();
    const b = mockOpts?.extraBody?.(mockRows[0]);
    expect(b).not.toHaveProperty('targetQuantity');
    expect(b).not.toHaveProperty('targetWeight');
  });

  it('⭐ hedef en ayarı KAPALI: En kutusu çizilmez, gövdeye en gitmez', async () => {
    mockWidth = false;
    mockQty = true;
    mockBlob = { tabletIeForm: { hedefDoldur: true } };
    mockRows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-hedef-sayilar')).toBeTruthy());
    expect(s.queryByTestId('ie-form-en')).toBeNull();
    expect(mockOpts?.extraBody?.(mockRows[0])).not.toHaveProperty('width');
  });

  it('⭐ öneri çipi: "Evet" → hedef kumaş / renk seçili, çip kalkar; öneri alana kendiliğinden yazılmaz', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui(colorRoute));
    const chip = await s.findByTestId('ie-form-desen-oneri');
    expect(chip).toHaveTextContent(/Tül Beyaz \(T-1\) mi\?.*belgede “DSN-7”.*Evet/);
    expect(s.getByTestId('renk-alani').props.children).toBe('bos');
    fireEvent.press(chip);
    fireEvent.press(s.getByTestId('ie-form-renk-oneri'));
    expect(s.queryByTestId('ie-form-desen-oneri')).toBeNull();
    expect(s.queryByTestId('ie-form-renk-oneri')).toBeNull();
    expect(s.getByTestId('renk-alani').props.children).toBe('c1');
    expect(s.getByText('Tül Beyaz')).toBeTruthy();
  });

  it('⭐ kayıt: ek alanlar form ucunun gövdesine; PER_PARTY satırda hedef metraj/kg GİTMEZ', async () => {
    fillOn();
    mockQty = true;
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

  it('⭐ hedef metraj ayarı açık + belgede hedef yok → gelen metre kutu içi "gelen metre" etiketiyle; yazınca rozet kalkar, değer gövdeye gider', async () => {
    fillOn();
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
    fillOn();
    mockQty = true;
    const base = row();
    const rolls = [{ key: 'a', meters: 40, weightKg: null, senderRollNo: '' }, { key: 'b', meters: 60.5, weightKg: null, senderRollNo: '' }];
    mockRows = [row({ form: { ...form, rolls }, detail: { ...base.detail, formFields: {} } } as unknown as Partial<DocRow>)];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('100.5'));
    expect(s.getByTestId('gelen-metreden-targetQuantity')).toBeTruthy();
  });

  it('düz karo (rota seçilmedi): belge okunsa da "Üretim Rotasını seçin." ile kapalı', async () => {
    mockRows = [row()];
    const s = renderWithPaper(ui(null));
    await waitFor(() => expect(s.getByTestId('ie-form-ipucu').props.children).toBe('Üretim Rotasını seçin.'));
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
  });
});

describe('UnifiedWoForm — vurgu, yerleşim ve kontrollü Alanlar', () => {
  it('⭐ belgeden dolan En sarı vurgulu, rozet yazısı yok; elle değişince vurgu kalkar', async () => {
    fillOn();
    mockQty = true;
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

  it('⭐ tablet yatay (1280×800): iki sütun — solda belge kartı, sağda üretim alanları; dikeyde tek sütun', async () => {
    fillOn();
    mockRows = [row()];
    mockDims = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    const left = within(s.getByTestId('ie-form-sol'));
    const right = within(s.getByTestId('ie-form-sag'));
    expect(left.getByTestId('satir-karti')).toBeTruthy();
    expect(left.queryByTestId('ie-belge-okut')).toBeNull();
    expect(right.getByTestId('ie-form-en')).toBeTruthy();
    expect(left.queryByTestId('ie-form-en')).toBeNull();
    // Oran içerikten bağımsız: kutular flexBasis 0 + eşit flex (kaydırıcı sarmalayıcısı basis:auto taşır, 69/31'e kaymıştı).
    const box = (id: string) => StyleSheet.flatten(s.getByTestId(id).props.style);
    expect(box('ie-form-sol-kutu')).toMatchObject({ flexBasis: 0, minWidth: 0, flex: 1 });
    expect(box('ie-form-sag-kutu')).toMatchObject({ flexBasis: 0, minWidth: 0, flex: 1 });
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
    expect(s.getByTestId('ie-rota-yolu')).toBeTruthy();
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
    mockQty = true;
    mockBlob = { tabletIeForm: { gizli: ['en', 'hedefKumas', 'planBitis'], hedefDoldur: true } };
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
    mockQty = true;
    mockBlob = { tabletIeForm: { gizli: ['en'], hedefDoldur: true } };
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

  describe('hedef kumaş / renk görünürlüğü', () => {
    const fasonOwners = ['STANDARD', 'CUSTOMER_GOODS'] as const;
    const pickFason = async (s: ReturnType<typeof renderWithPaper>) => fireEvent.press(await s.findByTestId('ie-mal-sahibi-CUSTOMER_GOODS'));
    const withDeclared = () => row({ detail: { ...row().detail, suggestions: {}, incomingDeclared: { itemText: 'DSN-7', colorText: 'Ekru', suggestedItem: { id: 'i9', name: 'Eşlenen Tül' }, suggestedColor: null } } as never });

    it('⭐ Fason: "Hedef kumaş" sorulmaz; kendi üretimin dışındaki (kart boş / bugünkü) formda görünür', async () => {
      mockRows = [row()];
      const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={[...fasonOwners]} />);
      expect(await s.findByTestId('ie-form-hedef-kumas')).toBeTruthy();
      await pickFason(s);
      expect(s.queryByTestId('ie-form-hedef-kumas')).toBeNull();
      s.unmount();
      expect(renderWithPaper(ui()).getByTestId('ie-form-hedef-kumas')).toBeTruthy();
    });
    it('⭐ Fason: belgenin eşlenen kartı hedef kumaşa gizlice yazılır (en öne); eşleme yoksa anahtar gitmez', async () => {
      mockRows = [withDeclared()];
      const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={[...fasonOwners]} />);
      await pickFason(s);
      await waitFor(() => expect(mockOpts?.extraBody?.(mockRows[0])).toMatchObject({ targetItemId: 'i9', type: 'CUSTOMER_GOODS_SERVICE' }));
      s.unmount();
      mockRows = [row({ detail: { ...row().detail, suggestions: {} } as never })];
      const t = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={[...fasonOwners]} />);
      await pickFason(t);
      expect(mockOpts?.extraBody?.(mockRows[0])).not.toHaveProperty('targetItemId');
    });
    it('⭐ hedef renk: renk veren adım yoksa gizli; veren adım varsa ve rotasızda görünür', async () => {
      mockRows = [row()];
      expect(renderWithPaper(ui(route)).queryByTestId('renk-alani')).toBeNull();
      expect(renderWithPaper(ui(colorRoute)).getByTestId('renk-alani')).toBeTruthy();
      expect(renderWithPaper(ui(SCAN_ROUTE)).getByTestId('renk-alani')).toBeTruthy();
    });
  });
});
