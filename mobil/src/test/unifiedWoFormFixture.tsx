// UnifiedWoForm testlerinin ortak taklitleri ve yardımcıları — test dosyaları ikiye bölündüğü için tek yerde.
// ⚠️ Test dosyası bunu UnifiedWoForm'dan ÖNCE import etmeli: jest.mock kayıtları bu modül yüklenince yapılır.
// Değişken durum `mockFx` alanlarında (jest.mock fabrikası yalnız `mock` önekli adlara erişir).
import React from 'react';
import { StyleSheet } from 'react-native';
import type { renderWithPaper } from './render';
import { DOC_HIGHLIGHT_BG } from '../components/DocHighlight';
import type { ProductionRoute } from '../services/route.service';
import type { DocRow, ExtraFormBody } from '../screens/Modules/GelenBelge/woCreate/useWoRows';
import UnifiedWoForm from '../screens/Modules/GelenBelge/woCreate/UnifiedWoForm';
// Kendi üretim kipinin top okutma kancası ses/titreşim katmanını çeker (expo-audio jest'te yüklenmez).
jest.mock('../services/scanFeedback', () => ({ signalScan: jest.fn() }));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockFx.dims }));

export const mockSaveAll = jest.fn();
export const mockAdd = jest.fn();
jest.mock('../screens/Modules/GelenBelge/woCreate/useWoRows', () => ({
  useWoRows: (_r: unknown, opts: typeof mockFx.opts) => {
    mockFx.opts = opts;
    return {
      rows: mockFx.rows,
      mode: 'WITH_WORK_ORDER',
      saving: false,
      counts: { ready: mockFx.rows.filter((r) => r.form && !r.result).length },
      saveAll: mockSaveAll,
      removeRow: jest.fn(),
      addNote: jest.fn(),
      duplicate: null,
      dismissDuplicate: jest.fn(),
      confirmDuplicate: jest.fn(),
    };
  },
}));
jest.mock('../screens/Modules/GelenBelge/woCreate/DocRowCard', () => {
  const { Text } = jest.requireActual('react-native');
  // Tek form kipi + "Yeniden okut" bağı görünsün: kart metnine kip, basışa onReread.
  return { __esModule: true, default: (p: { row: DocRow; variant?: string; onReread?: () => void }) => <Text testID="satir-karti" onPress={p.onReread}>{`${p.row.noteNo} ${p.variant ?? 'list'}`}</Text> };
});
export const PAGE = { base64: '', sha256: 's1', uri: 'file:///1.jpg', width: 10, height: 10 };
export const mockFx = {
  dims: { width: 800, height: 1280, scale: 1, fontScale: 1 },
  rows: [] as DocRow[],
  opts: undefined as { extraBody?: (r: DocRow) => ExtraFormBody } | undefined,
  scan: { pages: [], sending: false, headerLocked: false, uploaded: new Set() } as { pages: typeof PAGE[]; sending: boolean; headerLocked: boolean; uploaded: Set<string> },
  blob: {} as Record<string, unknown>,
  qty: false,
  width: undefined as boolean | undefined,
};

jest.mock('../screens/Modules/GelenBelge/useDocScan', () => ({
  useDocScan: () => ({ pages: mockFx.scan.pages, progress: { note: null, uploaded: mockFx.scan.uploaded }, sending: mockFx.scan.sending, headerLocked: mockFx.scan.headerLocked, done: null, finish: jest.fn(), reset: jest.fn(), setPages: jest.fn(), capture: jest.fn(), captureMany: jest.fn(), send: jest.fn(), remaining: mockFx.scan.pages.length }),
}));
jest.mock('../screens/Modules/GelenBelge/usePageSource', () => ({ usePageSource: () => ({ add: () => mockAdd(), busy: false, camera: { visible: false, capacity: 20, firstPageNo: 1, onDone: jest.fn(), onDismiss: jest.fn() } }) }));
jest.mock('../screens/Modules/GelenBelge/PageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/Modules/GelenBelge/MultiPageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/Modules/GelenBelge/PagePreviewModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../services/inboundDoc.service', () => ({ inboundDocService: { tabletContext: async () => ({ data: { customers: [] } }) } }));
// Kart iskeleti (kendi bekçisi ModuleSheet.test): görünürken içerik + alt düğmeler düz çizilir.
jest.mock('../components/ModuleSheet', () => {
  const actual = jest.requireActual('../components/ModuleSheet');
  return {
    ...actual,
    __esModule: true,
    default: (p: { visible: boolean; children: React.ReactNode; footer: React.ReactNode }) => (p.visible ? <>{p.children}{p.footer}</> : null),
  };
});
// K30-D kişisel tercih blob'u: bellek içi; panelin anahtarı (`theme`) her yazımda korunmalı.

export const mockPrefSave = jest.fn(async (b: Record<string, unknown>) => {
  mockFx.blob = b;
  return b;
});
jest.mock('../services/preferences.service', () => ({
  preferencesService: { get: async () => mockFx.blob, save: (b: Record<string, unknown>) => mockPrefSave(b) },
}));
jest.mock('../services/route.service', () => ({ routeService: { getActive: async () => ({ data: [] }) } }));
jest.mock('../hooks/useFoldValues', () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));

jest.mock('../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: mockFx.qty, targetWidthEnabled: mockFx.width } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../screens/Modules/HizliIsEmri/OrderLinkPicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/ColorSelectField', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string | null }) => <Text testID="renk-alani">{p.value ?? 'bos'}</Text> };
});

export const route = { id: 'r1', name: 'Kurşun&Tambur', steps: [] } as unknown as ProductionRoute;
// Renk veren (boyahane) adımı olan rota: hedef renk sorusu görünür.
export const colorRoute = { id: 'r2', name: 'Boya', steps: [{ id: 's1', stationId: 'st1', sequence: 1, station: { id: 'st1', name: 'Boya', appliesColor: true } }] } as unknown as ProductionRoute;
export const form = { ownerCustomerId: 'cu1', ownerSuggested: null, ourBatchNo: 'P-1', meters: 100, metersReview: false, multi: null };
export const row = (x: Partial<DocRow> = {}): DocRow =>
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

export const ui = (r: ProductionRoute | null = route) => <UnifiedWoForm initialRoute={r} routeLocked={r !== null} onNew={jest.fn()} />;

/** ⚙ "Belgedeki gelen değerleri hedefe yaz" açık (varsayılan kapalı; kopyalama davranışı bu anahtarla). */
export const fillOn = () => {
  const cur = (mockFx.blob?.tabletIeForm ?? {}) as Record<string, unknown>;
  mockFx.blob = { ...mockFx.blob, tabletIeForm: { ...cur, hedefDoldur: true } };
};

beforeEach(() => {
  mockFx.blob = { theme: 'dark' };
  mockFx.rows = [];
  mockFx.opts = undefined;
  mockFx.qty = false;
  mockFx.width = undefined;
  mockFx.dims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
  jest.clearAllMocks();
});

/** testID'li öğe ya da atalarından biri belgeden vurgusunda mı (Paper girdisinin stili sarmalayıcıya iner). */
export function highlighted(s: ReturnType<typeof renderWithPaper>, testID: string): boolean {
  type N = { props: { style?: unknown }; parent: N | null };
  let n: N | null = s.getByTestId(testID) as unknown as N;
  while (n) {
    if ((StyleSheet.flatten(n.props.style as never) as { backgroundColor?: unknown } | undefined)?.backgroundColor === DOC_HIGHLIGHT_BG) return true;
    n = n.parent;
  }
  return false;
}