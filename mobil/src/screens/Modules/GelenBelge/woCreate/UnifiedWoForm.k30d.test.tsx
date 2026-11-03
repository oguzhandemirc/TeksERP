// K30-D dilim 2: rota adımları (ekle/çıkar/sırala, kilitli rotada salt okunur), makine önerisi, iş emri türü kapısı ve
// hedef özellikler. Kural: kullanıcının dokunmadığı alan form ucunun gövdesine GİTMEZ (sunucu bugünkü yolu türetir).
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
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
jest.mock('./DocRowCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../useDocScan', () => ({
  useDocScan: () => ({ pages: [], progress: { uploaded: new Set() }, sending: false, headerLocked: false, done: null, finish: jest.fn(), reset: jest.fn(), setPages: jest.fn(), capture: jest.fn(), captureMany: jest.fn(), send: jest.fn(), remaining: 0 }),
}));
jest.mock('../usePageSource', () => ({ usePageSource: () => ({ add: jest.fn(), busy: false }) }));
jest.mock('../PageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../PagePreviewModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: { tabletContext: async () => ({ data: { customers: [], kursunMachines: [{ id: 'm1', code: 'K1', name: 'Kurşun 1', stationId: 'stK' }] } }) },
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
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: false } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../../HizliIsEmri/OrderLinkPicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/ColorSelectField', () => ({ __esModule: true, default: () => null }));

const form = { ownerCustomerId: 'cu1', ownerSuggested: null, ourBatchNo: 'P-1', meters: 100, metersReview: false, multi: null };
const row = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, gramajTouched: false, result: null, form, detail: { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', formFields: {}, suggestions: {} } } as unknown as DocRow;
const body = () => mockOpts?.extraBody?.(mockRows[0]) ?? {};

/** Düz karo: rota seçilmedi → seçiciden r1 seçilir (adımlar düzenlenebilir). */
async function openFree() {
  const s = renderWithPaper(<UnifiedWoForm initialRoute={null} routeLocked={false} onNew={jest.fn()} />);
  fireEvent.press(s.getByText('Rota seçin'));
  fireEvent.press(await s.findByTestId('secim-Rota-r1'));
  await s.findByTestId('ie-rota-adimlari');
  return s;
}

beforeEach(() => {
  mockBlob = {};
  mockDefaults = mockDefaultsLoaded();
  mockRows = [row];
  mockOpts = undefined;
  jest.clearAllMocks();
});

describe('UnifiedWoForm — rota adımları (K30-D)', () => {
  it('⭐ kilitli rota (özel İE kısayolu): adımlar salt okunur — düğme yok, "sabit" ipucu; gövdede steps yok', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    expect(await s.findByTestId('ie-adim-1-ad')).toHaveTextContent('1. Kurşun');
    expect(s.getByTestId('ie-adim-ipucu')).toHaveTextContent(/sabit/);
    for (const id of ['ie-adim-ekle', 'ie-adim-1-yukari', 'ie-adim-1-cikar', 'ie-adim-1-not', 'ie-adim-sablona-don']) expect(s.queryByTestId(id)).toBeNull();
    expect(body()).not.toHaveProperty('steps');
  });

  it('⭐ dokunulmayan adımlar GİTMEZ; çıkar/yukarı/ekle → tüm liste sırayla steps olarak gider', async () => {
    const s = await openFree();
    expect(s.getByTestId('ie-adim-ipucu')).toHaveTextContent(/şablonu aynen/);
    expect(body()).not.toHaveProperty('steps');
    fireEvent.press(s.getByTestId('ie-adim-2-yukari'));
    expect(s.getByTestId('ie-adim-1-ad')).toHaveTextContent('1. Boya');
    fireEvent.press(s.getByTestId('ie-adim-ekle'));
    fireEvent.press(s.getByTestId('secim-Adım ekle — istasyon-stP'));
    fireEvent.changeText(s.getByTestId('ie-adim-3-not'), ' son kontrol ');
    expect(body().steps).toEqual([
      { stationId: 'stB', sequence: 1, requiredCategoryId: 'catB' },
      { stationId: 'stK', sequence: 2 },
      { stationId: 'stP', sequence: 3, notes: 'son kontrol' },
    ]);
    fireEvent.press(s.getByTestId('ie-adim-1-cikar'));
    expect(body().steps).toEqual([{ stationId: 'stK', sequence: 1 }, { stationId: 'stP', sequence: 2, notes: 'son kontrol' }]);
    // Şablona dön → steps yine gitmez.
    fireEvent.press(s.getByTestId('ie-adim-sablona-don'));
    expect(body()).not.toHaveProperty('steps');
    expect(s.queryByTestId('ie-adim-3')).toBeNull();
  });

  it('fason adımda firma seçilir → plannedSubcontractorId; tüm adımlar çıkarılırsa "oluştur" kapalı', async () => {
    const s = await openFree();
    fireEvent.press(await s.findByTestId('ie-adim-2-firma-f1'));
    expect(body().steps?.[1]).toEqual({ stationId: 'stB', sequence: 2, requiredCategoryId: 'catB', plannedSubcontractorId: 'f1' });
    fireEvent.press(s.getByTestId('ie-adim-2-cikar'));
    fireEvent.press(s.getByTestId('ie-adim-1-cikar'));
    expect(s.getByTestId('ie-form-ipucu').props.children).toBe('Rotada en az bir adım kalmalı.');
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
  });

  it('⭐ makine önerisi kurşun adımı satırında: adımlar değişmediyse stepPlanning, değiştiyse steps[].plannedMachineId', async () => {
    const s = await openFree();
    expect(s.getByTestId('ie-adim-1')).toContainElement(await s.findByTestId('ie-form-makine'));
    expect(body()).not.toHaveProperty('stepPlanning');
    fireEvent.press(s.getByTestId('ie-form-makine-K1'));
    expect(body().stepPlanning).toEqual([{ sequence: 1, plannedMachineId: 'm1' }]);
    expect(body()).not.toHaveProperty('steps');
    fireEvent.press(s.getByTestId('ie-adim-2-yukari'));
    const b = body();
    expect(b).not.toHaveProperty('stepPlanning');
    expect(b.steps?.[1]).toEqual({ stationId: 'stK', sequence: 2, plannedMachineId: 'm1' });
  });
});

describe('UnifiedWoForm — iş emri türü ve hedef özellikler (K30-D)', () => {
  it('⭐ tür: dokunulmazsa gitmez (otomatik = Stoğa); Siparişe + kalemsiz → oluştur kapalı + ipucu; Stoğa → type gider', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    expect(await s.findByTestId('ie-form-tur')).toHaveTextContent(/Otomatik/);
    expect(body()).not.toHaveProperty('type');
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
    fireEvent.press(s.getByTestId('ie-form-tur-ORDER_PRODUCTION'));
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    expect(s.getByTestId('ie-form-ipucu').props.children).toMatch(/Siparişe üretim için sipariş kalemi seçin/);
    fireEvent.press(s.getByTestId('ie-form-tur-STOCK_PRODUCTION'));
    expect(body().type).toBe('STOCK_PRODUCTION');
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
    fireEvent.press(s.getByTestId('ie-form-tur-otomatik'));
    expect(body()).not.toHaveProperty('type');
  });

  it('⭐ hedef özellik: varsayılan (BAYRAK) seçili görünür ve gitmez; çipe dokununca tüm küme targetPropertyIds olarak gider', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    const p2 = await s.findByTestId('ie-form-ozellik-p2');
    expect(s.getByTestId('ie-form-ozellik')).toHaveTextContent(/Rotanın varsayılanları seçili/);
    expect(body()).not.toHaveProperty('targetPropertyIds');
    fireEvent.press(p2);
    expect(body().targetPropertyIds).toEqual(['p1', 'p2']);
    fireEvent.press(s.getByTestId('ie-form-ozellik-p1'));
    fireEvent.press(s.getByTestId('ie-form-ozellik-p2'));
    expect(body().targetPropertyIds).toEqual([]);
    fireEvent.press(s.getByTestId('ie-form-ozellik-varsayilan'));
    expect(body()).not.toHaveProperty('targetPropertyIds');
  });

  it('⚙ ile rota adımları kapatılınca editör çizilmez, makine önerisi tek başına kalır', async () => {
    mockBlob = { tabletIeForm: { gizli: ['rotaAdimlari', 'isEmriTuru', 'hedefOzellik'] } };
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (3)'));
    expect(s.queryByTestId('ie-rota-adimlari')).toBeNull();
    expect(s.queryByTestId('ie-form-tur')).toBeNull();
    expect(s.queryByTestId('ie-form-ozellik')).toBeNull();
    expect(await s.findByTestId('ie-form-makine')).toBeTruthy();
  });

  it('varsayılanlar yüklenirken özellik çipleri kapalı (boş kümeden yanlış targetPropertyIds kurulmaz)', async () => {
    mockDefaults = new Map();
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    const p2 = await s.findByTestId('ie-form-ozellik-p2');
    expect(p2).toBeDisabled();
    expect(s.getByTestId('ie-form-ozellik')).toHaveTextContent(/varsayılan özellikleri yükleniyor/);
    fireEvent.press(p2);
    expect(body()).not.toHaveProperty('targetPropertyIds');
  });
});

describe('UnifiedWoForm — gizli ama dolu alan / makine tutarlılığı (K30-D düzeltme)', () => {
  it('⭐ dokunulmuş alan ⚙ ile gizlenirse "Diğer alanlar" başlığı dolu olduğunu söyler; engel ipucu yerini gösterir', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    fireEvent.press(await s.findByTestId('ie-form-tur-ORDER_PRODUCTION'));
    fireEvent.press(s.getByTestId('ie-alanlar'));
    fireEvent.press(await s.findByTestId('ie-alan-isEmriTuru'));
    fireEvent.press(s.getByTestId('ie-alanlar-tamam'));
    await waitFor(() => expect(s.queryByTestId('ie-form-tur')).toBeNull());
    expect(s.getByTestId('ie-diger-alanlar-dolu')).toHaveTextContent('Dolu, kayda girecek: İş emri türü');
    expect(body().type).toBe('ORDER_PRODUCTION');
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    expect(s.getByTestId('ie-form-ipucu').props.children).toMatch(/"Diğer alanlar" bölümünde/);
    // Dokunulmamış gizli alan "dolu" sayılmaz.
    fireEvent.press(s.getByTestId('ie-diger-alanlar'));
    fireEvent.press(s.getByTestId('ie-form-tur-otomatik'));
    expect(s.queryByTestId('ie-diger-alanlar-dolu')).toBeNull();
  });

  it('⭐ kurşun adımı çıkarılınca seçilen makine düşer (şablona dönünce de eski seçim gitmez)', async () => {
    const s = await openFree();
    fireEvent.press(await s.findByTestId('ie-form-makine-K1'));
    expect(body().stepPlanning).toEqual([{ sequence: 1, plannedMachineId: 'm1' }]);
    fireEvent.press(s.getByTestId('ie-adim-1-cikar'));
    expect(s.queryByTestId('ie-form-makine')).toBeNull();
    expect(body().steps).toEqual([{ stationId: 'stB', sequence: 1, requiredCategoryId: 'catB' }]);
    fireEvent.press(s.getByTestId('ie-adim-sablona-don'));
    expect(body()).not.toHaveProperty('steps');
    expect(body()).not.toHaveProperty('stepPlanning');
  });

  it('her parti ayrı İE kipinde makine seçilmez ve form bunu söyler', async () => {
    mockRows = [{ ...row, form: { ...form, multi: { mode: 'PER_PARTY', rows: [] } } } as unknown as DocRow];
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    expect(await s.findByTestId('ie-form-makine-not')).toHaveTextContent(/her iş emrinde sonra seçilir/);
    expect(s.queryByTestId('ie-form-makine')).toBeNull();
  });
});
