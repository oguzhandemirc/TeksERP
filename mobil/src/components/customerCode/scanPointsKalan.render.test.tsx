// =============================================================================
// D4-KUC3d bekçisi — kalan tablet okutma noktalarında belirsiz müşteri barkodu
// (Depo · Fason Sevk · Hızlı Sipariş · Hızlı İş Emri top ekleme; Parti Ekle ve Muayene kendi testlerinde)
// =============================================================================
// Hepsi `GET /rolls/barcode/:code`i çağırır (`inventory.service findRollByBarcode` — tek boğaz
// `resolveRollByScanCode`, D4-F1'de müşteri koduna AÇIK). Sahte backend boğazı taklit eder:
// iç barkod önce, sonra müşteri kodu; ≥2 eşleşmede 409 CUSTOMER_CODE_AMBIGUOUS + adaylar.
// Kabul: belirsizlikte aday modalı açılır, seçim topun İÇ barkoduyla yeniden sorulur; müşteri
// koduyla bulunan topta not görünür; başka hata (eski backend 404) bugünkü yolda kalır.
// Negatif sonda: bir noktada `ambiguous.intercept` bağlantısı kaldırılınca o noktanın ⭐ testi kırmızı.
import React, { type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import { AMBIGUOUS_CODE, UNIQUE_CUSTOMER_CODE, ambiguousScanError, ambiguousTitle, customerCodeMatch } from '../../test/ambiguousScanFixture';
import HizliSiparisScreen from '../../screens/Modules/TartiPaket/HizliSiparisScreen';
import DepoScreen from '../../screens/Modules/Depo/DepoScreen';
import FasonSevkScreen from '../../screens/Modules/FasonSevk/FasonSevkScreen';
import { useQuickWorkOrder } from '../../screens/Modules/HizliIsEmri/useQuickWorkOrder';
import ScannerRollStrip from '../ScannerRollStrip';
import Toast from 'react-native-toast-message';
import { signalScan } from '../../services/scanFeedback';

const mockGet = jest.fn();
let mockScanCode = '';
let mockLegacyBackend = false;

const roll = (id: string, barcode: string) => ({
  id,
  barcode,
  itemId: 'i1',
  item: { id: 'i1', name: 'Tül' },
  color: null,
  status: 'STOCK',
  currentQty: 40,
  initialQty: 40,
  width: 280,
  qualityGrade: 'Q',
});
const ROLLS: Record<string, ReturnType<typeof roll>> = {
  H1: roll('r1', 'H1'),
  H2: roll('r2', 'H2'),
};

function rollByBarcode(code: string) {
  if (mockLegacyBackend) throw { status: 404, message: 'Endpoint bulunamadı', details: {} };
  if (ROLLS[code]) return { success: true, data: ROLLS[code] };
  if (code === UNIQUE_CUSTOMER_CODE) return { success: true, data: { ...ROLLS.H2, ...customerCodeMatch() } };
  if (code === AMBIGUOUS_CODE) {
    throw ambiguousScanError([
      { rollId: 'r1', barcode: 'H1', customerName: 'Acar Perde' },
      { rollId: 'r2', barcode: 'H2', customerName: 'Bora Tekstil' },
    ]);
  }
  return { success: false, data: null, message: 'Barkod bulunamadı' };
}

jest.mock('../../services/api', () => ({
  apiClient: {
    get: (url: string) => mockGet(url),
    post: jest.fn(async () => ({ data: { success: true, data: null } })),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
  isWorkSessionLost: () => false,
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../ScreenChrome', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => children }));
jest.mock('../RollPickerModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../services/reasonPreset.service', () => ({ reasonPresetService: { list: async () => [] } }));
jest.mock('../../hooks/useScanSeries', () => ({
  useScanClassifier: () => ({
    classify: () => ({ kind: 'UNKNOWN' }),
    matchesFullFormat: () => false,
    resolveOnServer: jest.fn(),
    classifyOrAsk: async () => ({ kind: 'ROLL' }),
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
// Tarayıcı: her ekranın tarayıcısı başlığıyla bir "okut" düğmesi çizer (görünürlükten bağımsız);
// okutma bitince `onModalHide` (Depo detayı tarayıcı kapanınca açar).
jest.mock('../BarcodeScannerModal', () => {
  const RN = jest.requireActual('react-native');
  return {
    BarcodeScannerModal: (p: { title?: string; footer?: unknown; onScan: (c: string) => unknown; onModalHide?: () => void }) => (
      <RN.View>
        <RN.Pressable testID={`fake-scan:${p.title ?? ''}`} onPress={() => void Promise.resolve(p.onScan(mockScanCode)).then(() => p.onModalHide?.())}>
          <RN.Text>{`okut:${p.title ?? ''}`}</RN.Text>
        </RN.Pressable>
        {p.footer as never}
      </RN.View>
    ),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLegacyBackend = false;
  mockGet.mockReset();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/rolls/barcode/')) return { data: rollByBarcode(decodeURIComponent(url.slice('/rolls/barcode/'.length))) };
    return { data: { success: true, data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 0 }, pagination: { hasMore: false, nextCursor: null } } };
  });
});

async function scanWith(title: string, code: string) {
  mockScanCode = code;
  await act(async () => {
    fireEvent.press(await screen.findByTestId(`fake-scan:${title}`));
  });
}

const lastRollCall = () => mockGet.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/rolls/barcode/')).pop();

describe('Hızlı Sipariş', () => {
  const TITLE = 'Ham Top Okut';

  it('⭐ belirsiz kod → aday modalı; seçim İÇ barkodla yeniden sorulur, top listeye girer', async () => {
    renderWithPaper(<HizliSiparisScreen />);
    await scanWith(TITLE, AMBIGUOUS_CODE);
    expect(await screen.findByText(ambiguousTitle())).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('H2')));
    await waitFor(() => expect(lastRollCall()).toBe('/rolls/barcode/H2'));
    expect(await screen.findByText(/Okutulan Toplar \(1 top/)).toBeTruthy();
    expect(screen.queryByTestId('musteri-kodu-eslesme')).toBeNull();
  });

  it('⭐ müşteri koduyla bulunan top → satırda not', async () => {
    renderWithPaper(<HizliSiparisScreen />);
    await scanWith(TITLE, UNIQUE_CUSTOMER_CODE);
    expect(await screen.findByTestId('musteri-kodu-eslesme')).toHaveTextContent('Müşteri barkodu ACR500 ile bulundu');
  });

  it('eski backend 404 → modal YOK (bugünkü sessiz yol)', async () => {
    mockLegacyBackend = true;
    renderWithPaper(<HizliSiparisScreen />);
    await scanWith(TITLE, AMBIGUOUS_CODE);
    expect(screen.queryByText(ambiguousTitle())).toBeNull();
    expect(Toast.show).not.toHaveBeenCalled();
    expect(screen.queryByText(/Okutulan Toplar \(1 top/)).toBeNull();
  });
});

describe('Depo', () => {
  const TITLE = 'Top Barkodu Okut';

  it('⭐ belirsiz kod → aday modalı; seçim İÇ barkodla yeniden sorulur, detay açılır', async () => {
    renderWithPaper(<DepoScreen />);
    await scanWith(TITLE, AMBIGUOUS_CODE);
    expect(await screen.findByText(ambiguousTitle())).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('H1')));
    await waitFor(() => expect(lastRollCall()).toBe('/rolls/barcode/H1'));
    await waitFor(() => expect(screen.queryByText(ambiguousTitle())).toBeNull());
    expect(await screen.findByText(/Yaşam Döngüsü/)).toBeTruthy();
    expect(screen.queryByTestId('musteri-kodu-eslesme')).toBeNull();
  });

  it('⭐ müşteri koduyla bulunan top → detayda not', async () => {
    renderWithPaper(<DepoScreen />);
    await scanWith(TITLE, UNIQUE_CUSTOMER_CODE);
    expect(await screen.findByTestId('musteri-kodu-eslesme')).toHaveTextContent('Müşteri barkodu ACR500 ile bulundu');
  });

  it('eski backend 404 → modal YOK (bugünkü "Sorgulanamadı" yolu)', async () => {
    mockLegacyBackend = true;
    renderWithPaper(<DepoScreen />);
    await scanWith(TITLE, AMBIGUOUS_CODE);
    expect(screen.queryByText(ambiguousTitle())).toBeNull();
    expect(signalScan).toHaveBeenCalledWith('reject');
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Sorgulanamadı' }));
  });
});

describe('Fason Sevk', () => {
  const TITLE = 'Top Barkodunu Okut';

  it('⭐ belirsiz kod → aday modalı; seçim İÇ barkodla yeniden sorulur, top listeye girer', async () => {
    renderWithPaper(<FasonSevkScreen />);
    await scanWith(TITLE, AMBIGUOUS_CODE);
    expect(await screen.findByText(ambiguousTitle())).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('H2')));
    await waitFor(() => expect(lastRollCall()).toBe('/rolls/barcode/H2'));
    await waitFor(() => expect(screen.queryByText(ambiguousTitle())).toBeNull());
    // İş emri seçilmeden sevk listesi kartı çizilmez; seçilen top tarayıcı şeridine girer.
    expect(await screen.findByText('H2')).toBeTruthy();
    expect(screen.queryByTestId('musteri-kodu-eslesme')).toBeNull();
  });

  it('⭐ müşteri koduyla bulunan top → satırda not', async () => {
    renderWithPaper(<FasonSevkScreen />);
    await scanWith(TITLE, UNIQUE_CUSTOMER_CODE);
    expect((await screen.findAllByTestId('musteri-kodu-eslesme'))[0]).toHaveTextContent('Müşteri barkodu ACR500 ile bulundu');
  });

  it('eski backend 404 → modal YOK (bugünkü ret yolu)', async () => {
    mockLegacyBackend = true;
    renderWithPaper(<FasonSevkScreen />);
    await scanWith(TITLE, AMBIGUOUS_CODE);
    expect(screen.queryByText(ambiguousTitle())).toBeNull();
    expect(signalScan).toHaveBeenCalledWith('reject');
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Top eklenmedi' }));
  });
});

/** Hızlı İş Emri'nin top okutma kancası — ekranın kullandığı modal ve şerit aynen bağlanır. */
function QuickWorkOrderHost() {
  const wo = useQuickWorkOrder();
  return (
    <>
      <Pressable testID="fake-scan:quick" onPress={() => void wo.handleScan(mockScanCode)}>
        <Text>okut</Text>
      </Pressable>
      <ScannerRollStrip rolls={wo.scanned} totalQty={wo.totalQty} onRemove={wo.removeRoll} />
      {wo.ambiguousModal}
    </>
  );
}

describe('Hızlı İş Emri — top ekleme', () => {
  it('⭐ belirsiz kod → aday modalı; seçim İÇ barkodla yeniden sorulur, top şeride girer', async () => {
    renderWithPaper(<QuickWorkOrderHost />);
    await scanWith('quick', AMBIGUOUS_CODE);
    expect(await screen.findByText(ambiguousTitle())).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('H1')));
    await waitFor(() => expect(lastRollCall()).toBe('/rolls/barcode/H1'));
    await waitFor(() => expect(screen.queryByText(ambiguousTitle())).toBeNull());
    expect(await screen.findByText('H1')).toBeTruthy();
    expect(screen.queryByTestId('musteri-kodu-eslesme')).toBeNull();
  });

  it('⭐ müşteri koduyla bulunan top → şeritte not', async () => {
    renderWithPaper(<QuickWorkOrderHost />);
    await scanWith('quick', UNIQUE_CUSTOMER_CODE);
    expect(await screen.findByTestId('musteri-kodu-eslesme')).toHaveTextContent('Müşteri barkodu ACR500 ile bulundu');
  });

  it('eski backend 404 → modal YOK (bugünkü "Okunamadı" yolu)', async () => {
    mockLegacyBackend = true;
    renderWithPaper(<QuickWorkOrderHost />);
    await scanWith('quick', AMBIGUOUS_CODE);
    expect(screen.queryByText(ambiguousTitle())).toBeNull();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Top eklenmedi' }));
  });

  it('⭐ ekran bağlantısı: NewWorkOrderView kancanın modalını çizer (yoksa intercept okutmayı sessizce yutar)', () => {
    // Ekran ağır (iş emri formu + servisler); render yerine kaynakta modal satırı ölçülür — davranışı yukarıdaki Host sınar.
    const src = jest.requireActual<typeof import('fs')>('fs').readFileSync(
      require.resolve('../../screens/Modules/HizliIsEmri/NewWorkOrderView.tsx'),
      'utf8',
    );
    expect(src).toMatch(/useQuickWorkOrder\(/);
    expect(src).toMatch(/\{wo\.ambiguousModal\}/);
  });
});
