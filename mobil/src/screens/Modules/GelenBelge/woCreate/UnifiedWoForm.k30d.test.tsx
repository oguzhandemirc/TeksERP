// K30-D dilim 2: rota adımları (ekle/çıkar/sırala, kilitli rotada salt okunur), makine önerisi, iş emri türünün bağdan
// türemesi ve hedef özellikler. Kural: kullanıcının dokunmadığı alan form ucunun gövdesine GİTMEZ (sunucu bugünkü yolu türetir).
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { ProductionRoute } from '../../../../services/route.service';
import type { DocRow, ExtraFormBody } from './useWoRows';
import UnifiedWoForm from './UnifiedWoForm';
import { TERIM } from '../../../../lib/terim';
// Kendi üretim kipinin top okutma kancası ses/titreşim katmanını çeker (expo-audio jest'te yüklenmez).
jest.mock('../../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));

let mockRows: DocRow[] = [];
let mockOpts: { extraBody?: (r: DocRow) => ExtraFormBody } | undefined;
const mockSaveAll = jest.fn();
const mockQuickStart = jest.fn(async (_b: Record<string, unknown>) => ({ data: { workOrder: { id: 'w1', workOrderNumber: 'IE-9' }, attached: 0, batch: null } }));
jest.mock('../../../../services/workOrder.service', () => ({
  ...jest.requireActual('../../../../services/workOrder.service'),
  workOrderService: { quickStart: (b: Record<string, unknown>) => mockQuickStart(b) },
}));
jest.mock('../../../../components/BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../../../../components/RollPickerModal', () => ({ __esModule: true, default: () => null }));
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
jest.mock('../usePageSource', () => ({ usePageSource: () => ({ add: jest.fn(), busy: false, camera: { visible: false, capacity: 20, firstPageNo: 1, onDone: jest.fn(), onDismiss: jest.fn() } }) }));
jest.mock('../PageCameraModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../MultiPageCameraModal', () => ({ __esModule: true, default: () => null }));
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
    { id: 's1', stationId: 'stK', sequence: 1, station: station('stK', 'Kurşun', { isKursunStation: true, defaultCategory: { id: 'catK', name: 'Kurşun' } }) },
    { id: 's2', stationId: 'stB', sequence: 2, requiredCategoryId: 'catB', station: station('stB', 'Boya', { kind: 'SUBCONTRACTOR', defaultCategory: { id: 'catB', name: 'Boyahane' } }) },
  ],
} as unknown as ProductionRoute;
const other = { id: 'r2', name: 'Paket', steps: [{ id: 's9', stationId: 'stP', sequence: 1, station: station('stP', 'Paketleme') }] } as unknown as ProductionRoute;
jest.mock('../../../../services/route.service', () => ({ routeService: { getActive: async () => ({ data: [mockRoute, mockOther] }) } }));
const mockRoute = route;
const mockOther = other;
jest.mock('../../../../hooks/useFoldValues', () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));
jest.mock('../../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: { targetQuantityEnabled: false } }),
  useScanRouteMode: () => false,
  usePickableLifecycle: () => ['ACTIVE'],
}));
jest.mock('../../HizliIsEmri/OrderLinkPicker', () => {
  const { Pressable } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { onChange: (ids: string[]) => void }) => <Pressable testID="mock-siparis-bagla" onPress={() => p.onChange(['l1'])} /> };
});
jest.mock('../../../../components/ColorSelectField', () => ({ __esModule: true, default: () => null }));

const form = { ownerCustomerId: 'cu1', ownerSuggested: null, ourBatchNo: 'P-1', meters: 100, metersReview: false, multi: null };
const row = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, gramajTouched: false, result: null, form, detail: { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', formFields: {}, suggestions: {} } } as unknown as DocRow;
const body = () => mockOpts?.extraBody?.(mockRows[0]) ?? {};

/** Düz karo: rota seçilmedi → seçiciden r1 seçilir (adımlar düzenlenebilir). */
async function openFree() {
  const s = renderWithPaper(<UnifiedWoForm initialRoute={null} routeLocked={false} onNew={jest.fn()} />);
  fireEvent.press(s.getByText('Üretim Rotası seç'));
  fireEvent.press(await s.findByTestId('secim-Üretim Rotası-r1'));
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
  it('⭐ kilitli rota (özel İE kısayolu): editör çizilmez, adımlar yol satırında; makine kendi şeridinde; gövdede steps yok', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    expect(await s.findByTestId('ie-rota-yolu')).toHaveTextContent('Kurşun › Boya');
    expect(s.queryByTestId('ie-rota-adimlari')).toBeNull();
    expect(await s.findByTestId('ie-serit-makine')).toHaveTextContent(/Makine seç/);
    for (const id of ['ie-adim-ekle', 'ie-adim-1-yukari', 'ie-adim-1-cikar', 'ie-adim-1-not', 'ie-adim-sablona-don']) expect(s.queryByTestId(id)).toBeNull();
    expect(body()).not.toHaveProperty('steps');
  });

  it('⭐ dokunulmayan adımlar GİTMEZ; çıkar/yukarı/ekle → tüm liste sırayla steps olarak gider', async () => {
    const s = await openFree();
    expect(s.queryByTestId('ie-adim-ipucu')).toBeNull();
    expect(body()).not.toHaveProperty('steps');
    fireEvent.press(s.getByTestId('ie-adim-2-yukari'));
    expect(s.getByTestId('ie-adim-1-ad')).toHaveTextContent('1. Boya');
    expect(s.getByTestId('ie-adim-ipucu')).toHaveTextContent(/Adımları değiştirdiniz/);
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
    // Süreç türü olan İÇ istasyon fason değildir: firma satırı yok, etiketi "Fabrikada"; dış işlem "Fason".
    expect(s.queryByTestId('ie-adim-1-firma')).toBeNull();
    expect(s.getByTestId('ie-adim-1-tur')).toHaveTextContent('Fabrikada');
    expect(s.getByTestId('ie-adim-2-tur')).toHaveTextContent('Fason');
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
  it('⭐ tür formda sorulmaz: bağ yoksa type gitmez (sunucu Stoğa türetir); sipariş bağlanınca yalnız orderLineIds gider (sunucu Siparişe)', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    await s.findByTestId('ie-form-siparis');
    expect(s.queryByTestId('ie-form-tur')).toBeNull();
    expect(s.queryByText('Siparişe üretim')).toBeNull();
    expect(s.queryByText('Stoğa üretim')).toBeNull();
    expect(body()).not.toHaveProperty('type');
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
    fireEvent.press(s.getByTestId('mock-siparis-bagla'));
    expect(body().orderLineIds).toEqual(['l1']);
    expect(body()).not.toHaveProperty('type');
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
  });

  it('⭐ "Kendi Üretimimiz" seçiliyken kalemsiz kayıt açıkça Stoğa gider; kalem bağlanınca type gitmez; Fason bugünkü gibi', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={['STANDARD', 'CUSTOMER_GOODS']} />);
    fireEvent.press(await s.findByTestId('ie-mal-sahibi-STANDARD'));
    expect(body().type).toBe('STOCK_PRODUCTION');
    fireEvent.press(s.getByTestId('mock-siparis-bagla'));
    expect(body().orderLineIds).toEqual(['l1']);
    expect(body()).not.toHaveProperty('type');
    fireEvent.press(s.getByTestId('ie-mal-sahibi-CUSTOMER_GOODS'));
    expect(body().type).toBe('CUSTOMER_GOODS_SERVICE');
  });

  it('⭐ malın sahibi: adlar "Kendi Üretimimiz" / "Fason Üretim"; kartta hata çerçevesi/yazısı yok, eksik alt çubukta hap', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={['STANDARD', 'CUSTOMER_GOODS']} />);
    const card = await s.findByTestId('ie-mal-sahibi');
    const framed = () => JSON.stringify(s.getByTestId('ie-mal-sahibi').props.style).includes('borderColor');
    expect(card).toHaveTextContent(/Kendi Üretimimiz/);
    expect(card).toHaveTextContent(/Fason Üretim/);
    expect(s.queryByTestId('ie-mal-sahibi-sec')).toBeNull();
    expect(framed()).toBe(false);
    expect(s.getByTestId('ie-eksik-malSahibi')).toHaveTextContent(/Kendi Üretimimiz \/ Fason Üretim seçin/);
    // Hap zaten söylüyor: ikinci satır çizilmez; oluşturma kapalı (diğer zorunlu alanlarla aynı kalıp).
    expect(s.queryByTestId('ie-form-ipucu')).toBeNull();
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    fireEvent.press(s.getByTestId('ie-mal-sahibi-STANDARD'));
    expect(s.queryByTestId('ie-eksik-malSahibi')).toBeNull();
    expect(framed()).toBe(false);
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
    // Kendi üretim: belge taslağı yolu (saveAll) değil, quick-start + ownGoods (topsuz da açılır).
    fireEvent.press(s.getByTestId('ie-form-olustur'));
    await waitFor(() => expect(mockQuickStart).toHaveBeenCalledTimes(1));
    expect(mockSaveAll).not.toHaveBeenCalled();
  });

  it('⭐ kendi üretim kipi: sol sütun "Toplar" bölümü, kayıt quick-start ownGoods + STOCK, not gitmez, sonuç kartı', async () => {
    mockQuickStart.mockClear();
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={['STANDARD']} />);
    expect(await s.findByTestId('ie-kendi-toplar')).toBeTruthy();
    expect(s.getByTestId('ie-kendi-topsuz')).toBeTruthy();
    expect(s.queryByTestId('ie-mal-sahibi-sec')).toBeNull();
    fireEvent.press(s.getByTestId('ie-form-olustur'));
    await waitFor(() => expect(mockQuickStart).toHaveBeenCalledTimes(1));
    const sent = mockQuickStart.mock.calls[0][0];
    expect(sent).toMatchObject({ ownGoods: true, rollBarcodes: [], type: 'STOCK_PRODUCTION', routeTemplateId: 'r1' });
    expect(sent).not.toHaveProperty('notes');
    expect(typeof sent.clientToken).toBe('string');
    expect(mockSaveAll).not.toHaveBeenCalled();
    expect(await s.findByTestId('ie-kendi-sonuc')).toHaveTextContent(/IE-9 oluşturuldu/);
  });

  it('⭐ fason (tek tür ya da kartta seçili): "Toplar" bölümü yok, bugünkü belge yolu', async () => {
    const a = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={['CUSTOMER_GOODS']} />);
    await a.findByTestId('ie-form-olustur');
    expect(a.queryByTestId('ie-kendi-toplar')).toBeNull();
    a.unmount();
    const b = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={['STANDARD', 'CUSTOMER_GOODS']} />);
    fireEvent.press(await b.findByTestId('ie-mal-sahibi-CUSTOMER_GOODS'));
    expect(b.queryByTestId('ie-kendi-toplar')).toBeNull();
    fireEvent.press(b.getByTestId('ie-mal-sahibi-STANDARD'));
    expect(b.getByTestId('ie-kendi-toplar')).toBeTruthy();
  });

  it('⭐ hedef özellik: varsayılan (BAYRAK) seçili görünür ve gitmez; çipe dokununca tüm küme targetPropertyIds olarak gider', async () => {
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} />);
    const p2 = await s.findByTestId('ie-form-ozellik-p2');
    expect(s.getByTestId('ie-serit-ozellik-durum')).toHaveTextContent('varsayılan');
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
    // Eski tercihteki 'isEmriTuru' tanınmaz → sayılmaz.
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (2)'));
    expect(s.queryByTestId('ie-rota-adimlari')).toBeNull();
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
    fireEvent.changeText(await s.findByTestId('ie-form-en'), '0');
    fireEvent.press(s.getByTestId('ie-alanlar'));
    fireEvent.press(await s.findByTestId('ie-alan-en'));
    fireEvent.press(s.getByTestId('ie-alanlar-tamam'));
    await waitFor(() => expect(s.queryByTestId('ie-form-en')).toBeNull());
    expect(s.getByTestId('ie-diger-alanlar-dolu')).toHaveTextContent('Dolu, kayda girecek: En (cm)');
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    expect(s.getByTestId('ie-form-ipucu').props.children).toMatch(/"Diğer alanlar" bölümünde/);
    // Dokunulmamış (boşaltılmış) gizli alan "dolu" sayılmaz.
    fireEvent.press(s.getByTestId('ie-diger-alanlar'));
    fireEvent.changeText(await s.findByTestId('ie-form-en'), '');
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
    expect(await s.findByTestId('ie-form-makine-not')).toHaveTextContent(`Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} olur; makine parti kartlarında seçilir.`);
    expect(s.queryByTestId('ie-form-makine')).toBeNull();
  });
});
