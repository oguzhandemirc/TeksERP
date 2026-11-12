// UnifiedWoForm K30-D testlerinin (rota adımları, tür, hedef özellik) ortak taklitleri ve yardımcıları.
// ⚠️ Test dosyası bunu UnifiedWoForm'dan ÖNCE import etmeli: jest.mock kayıtları bu modül yüklenince yapılır.
// Değişken durum `mockFx` alanlarında (jest.mock fabrikası yalnız `mock` önekli adlara erişir).
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from './render';
import type { ProductionRoute } from '../services/route.service';
import type { DocRow, ExtraFormBody } from '../screens/Modules/GelenBelge/woCreate/useWoRows';
import UnifiedWoForm from '../screens/Modules/GelenBelge/woCreate/UnifiedWoForm';
import { useAuthStore } from '../store/authStore';
// Kendi üretim kipinin top okutma kancası ses/titreşim katmanını çeker (expo-audio jest'te yüklenmez).
jest.mock('../services/scanFeedback', () => ({ signalScan: jest.fn() }));

export const mockSaveAll = jest.fn();
export const mockQuickStart = jest.fn(async (_b: Record<string, unknown>) => ({ data: { workOrder: { id: 'w1', workOrderNumber: 'IE-9' }, attached: 0, batch: null } }));
jest.mock('../services/workOrder.service', () => ({
  ...jest.requireActual('../services/workOrder.service'),
  workOrderService: { quickStart: (b: Record<string, unknown>) => mockQuickStart(b) },
}));
jest.mock('../components/BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../components/RollPickerModal', () => ({ __esModule: true, default: () => null }));
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
jest.mock('../screens/Modules/GelenBelge/woCreate/DocRowCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/Modules/GelenBelge/useDocScan', () => ({
  useDocScan: () => ({ pages: [], progress: { uploaded: new Set() }, sending: false, headerLocked: false, done: null, finish: jest.fn(), reset: jest.fn(), setPages: jest.fn(), capture: jest.fn(), captureMany: jest.fn(), send: jest.fn(), remaining: 0 }),
}));
jest.mock('../screens/Modules/GelenBelge/usePageSource', () => ({ usePageSource: () => ({ add: jest.fn(), busy: false, camera: { visible: false, capacity: 20, firstPageNo: 1, onDone: jest.fn(), onDismiss: jest.fn() } }) }));
jest.mock('../screens/Modules/GelenBelge/PageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/Modules/GelenBelge/MultiPageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/Modules/GelenBelge/PagePreviewModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../services/inboundDoc.service', () => ({
  inboundDocService: { tabletContext: async () => ({ data: { customers: [], kursunMachines: [{ id: 'm1', code: 'K1', name: 'Kurşun 1', stationId: 'stK' }] } }) },
}));
jest.mock('../components/ModuleSheet', () => {
  const actual = jest.requireActual('../components/ModuleSheet');
  return {
    ...actual,
    __esModule: true,
    default: (p: { visible: boolean; children: React.ReactNode; footer: React.ReactNode }) => (p.visible ? <>{p.children}{p.footer}</> : null),
  };
});

jest.mock('../services/preferences.service', () => ({
  preferencesService: { get: async () => mockFx.blob, save: async (b: Record<string, unknown>) => (mockFx.blob = b) },
}));
// Seçici: görünürken her seçenek bir düğme (`secim-<başlık>-<değer>`).
jest.mock('../components/PickerModal', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { visible: boolean; title: string; options: { value: string; label: string }[]; onSelect: (v: string) => void }) =>
      p.visible ? (
        <View>
          {p.options.map((o) => (
            <Pressable key={o.value} onPress={() => p.onSelect(o.value)} testID={`secim-${p.title}-${o.value}`}>
              <Text>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null,
  };
});
jest.mock('../services/fabricProperty.service', () => ({
  fabricPropertyService: { getAll: async () => ({ data: [{ id: 'p1', name: 'Yanmaz' }, { id: 'p2', name: 'Antibakteriyel' }] }) },
}));
// Rotanın varsayılan hedefleri: p1 (BAYRAK) + bir SEÇİM (tablet listesine girmez).
const mockDefaultsLoaded = () => new Map([['cu1', [{ stationId: 'stK', targets: [{ propertyId: 'p1', valueType: 'FLAG' }, { propertyId: 'pc', valueType: 'CHOICE' }] }]]]);
export const mockFx = {
  rows: [] as DocRow[],
  opts: undefined as { extraBody?: (r: DocRow) => ExtraFormBody } | undefined,
  blob: {} as Record<string, unknown>,
  defaults: mockDefaultsLoaded() as Map<string, unknown>,
};

jest.mock('../hooks/useRouteDefaultTargets', () => ({ useRouteDefaultTargets: () => ({ byCustomer: mockFx.defaults }) }));
jest.mock('../services/subcontractor.service', () => ({
  subcontractorService: { listSubcontractors: async () => ({ data: [{ id: 'f1', name: 'Boyacı A', categories: [{ categoryId: 'catB' }] }] }) },
}));
export const station = (id: string, name: string, x: Record<string, unknown> = {}) => ({ id, name, kind: 'PROCESS', ...x });
export const route = {
  id: 'r1',
  name: 'Kurşun → Boya',
  steps: [
    { id: 's1', stationId: 'stK', sequence: 1, station: station('stK', 'Kurşun', { isKursunStation: true, defaultCategory: { id: 'catK', name: 'Kurşun' } }) },
    { id: 's2', stationId: 'stB', sequence: 2, requiredCategoryId: 'catB', station: station('stB', 'Boya', { kind: 'SUBCONTRACTOR', defaultCategory: { id: 'catB', name: 'Boyahane' } }) },
  ],
} as unknown as ProductionRoute;
export const other = { id: 'r2', name: 'Paket', steps: [{ id: 's9', stationId: 'stP', sequence: 1, station: station('stP', 'Paketleme') }] } as unknown as ProductionRoute;
jest.mock('../services/route.service', () => ({ routeService: { getActive: async () => ({ data: [mockRoute, mockOther] }) } }));
const mockRoute = route;
const mockOther = other;
jest.mock('../hooks/useFoldValues', () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));
jest.mock('../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: false } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../screens/Modules/HizliIsEmri/OrderLinkPicker', () => {
  const { Pressable } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { onChange: (ids: string[]) => void }) => <Pressable testID="mock-siparis-bagla" onPress={() => p.onChange(['l1'])} /> };
});
jest.mock('../components/ColorSelectField', () => ({ __esModule: true, default: () => null }));

export const form = { ownerCustomerId: 'cu1', ownerSuggested: null, ourBatchNo: 'P-1', meters: 100, metersReview: false, multi: null };
export const row = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, gramajTouched: false, result: null, form, detail: { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', formFields: {}, suggestions: {} } } as unknown as DocRow;
export const body = () => mockFx.opts?.extraBody?.(mockFx.rows[0]) ?? {};

/** Düz karo: rota seçilmedi → seçiciden r1 seçilir (adımlar düzenlenebilir). */
export async function openFree() {
  const s = renderWithPaper(<UnifiedWoForm initialRoute={null} routeLocked={false} onNew={jest.fn()} />);
  fireEvent.press(s.getByText('Üretim Rotası seç'));
  fireEvent.press(await s.findByTestId('secim-Üretim Rotası-r1'));
  await s.findByTestId('ie-rota-adimlari');
  return s;
}

// Parti no tahmini ve kendi üretim kaydı ucun iznine kapılı (useOurBatchPreview · useOwnGoodsCreate).
beforeEach(() => {
  useAuthStore.setState({ user: { permissions: ['mobile:hizli-is-emri', 'workorder:read'] } as never });
  mockFx.blob = { tabletIeForm: { hedefDoldur: true } };
  mockFx.defaults = mockDefaultsLoaded();
  mockFx.rows = [row];
  mockFx.opts = undefined;
  jest.clearAllMocks();
});
