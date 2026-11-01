// =============================================================================
// D4-KUC3b bekçisi — F4 dışı okutma noktalarında müşteri barkodu (Çuval Düzelt · İade Girişi)
// =============================================================================
// Sahte backend tek okutma boğazını taklit eder: `/shipping/locate-roll` ve `/returns/lookup`
// iç barkodu VE müşteri barkodunu çözer (D4-F1b [AÇIK]); iç barkod araması (`/rolls/barcode/…`)
// yalnız iç barkodu bilir. Müşteri kodu okutulunca DOĞRU top görünür; belirsiz kodda (409
// CUSTOMER_CODE_AMBIGUOUS) aday modalı açılır, seçim topun İÇ barkoduyla yeniden sorulur.
// Negatif sonda: ekran okutmayı boğaz ucu yerine iç barkod aramasına (rollService.getByBarcode)
// döndürünce "müşteri kodu → doğru top" testleri kırmızı.
import React, { type ReactNode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import CuvalDuzeltScreen from '../../screens/Modules/TartiPaket/CuvalDuzeltScreen';
import IadeGirisiScreen from '../../screens/Modules/IadeGirisi/IadeGirisiScreen';

const mockGet = jest.fn();
let mockScanCode = '';

/** İç barkod → top; müşteri barkodu → top(lar). MK77 iki müşteride (belirsiz). */
const ROLLS: Record<string, { id: string; barcode: string; customerName: string }> = {
  H251030001: { id: 'r1', barcode: 'H251030001', customerName: 'Acar Perde' },
  H251030002: { id: 'r2', barcode: 'H251030002', customerName: 'Bora Tekstil' },
};
const CUSTOMER_CODES: Record<string, string[]> = { ACR500: ['H251030002'], MK77: ['H251030001', 'H251030002'] };
/** Çuval Düzelt taşıma dalı (D4-KUC3d) için: iki top iki ayrı çuvalda. */
const SACKS: Record<string, { id: string; sackNo: string; seq: number }> = {
  H251030001: { id: 's1', sackNo: 'C-1', seq: 1 },
  H251030002: { id: 's2', sackNo: 'C-2', seq: 2 },
};
let mockWithSacks = false;

function notFound(): never {
  throw { status: 404, message: 'Bu barkodla top bulunamadı', details: {} };
}

/** Sunucu boğazının aynası: iç barkod önce, sonra müşteri kodu; ≥2 eşleşmede 409 + adaylar. */
function resolveLikeServer(code: string) {
  const own = ROLLS[code];
  if (own) return { roll: own, extras: {} };
  const hits = CUSTOMER_CODES[code] ?? [];
  if (hits.length === 0) notFound();
  if (hits.length > 1) {
    throw {
      status: 409,
      message: 'Bu müşteri barkodu birden çok topta',
      details: {
        code: 'CUSTOMER_CODE_AMBIGUOUS',
        scannedCode: code,
        candidates: hits.map((b) => ({
          rollId: ROLLS[b].id,
          barcode: b,
          customerId: ROLLS[b].id,
          customerName: ROLLS[b].customerName,
          code,
          currentQty: 40,
          status: 'SHIPPED',
        })),
      },
    };
  }
  return { roll: ROLLS[hits[0]], extras: { matchedBy: 'CUSTOMER_CODE', customerCode: code } };
}

function fakeBackend(url: string) {
  const q = decodeURIComponent(url.split('barcode=')[1] ?? '');
  if (url.startsWith('/shipping/locate-roll')) {
    const { roll, extras } = resolveLikeServer(q);
    return {
      success: true,
      data: {
        id: roll.id,
        barcode: roll.barcode,
        status: 'IN_STOCK',
        currentQty: 40,
        width: 280,
        qualityGrade: 'Q',
        item: { id: 'i1', name: 'Tül' },
        color: null,
        sack: mockWithSacks ? SACKS[roll.barcode] : null,
        shipment: null,
        ...extras,
      },
    };
  }
  if (url.startsWith('/returns/lookup')) {
    const { roll, extras } = resolveLikeServer(q);
    return {
      success: true,
      data: {
        roll: { id: roll.id, barcode: roll.barcode, item: null, color: null, width: 280, currentQty: 40, qualityGrade: 'Q', qualityGradeRef: null, ...extras },
        shipment: { id: 's1', shipmentNo: 'SV-1', dispatchedAt: null },
        customer: { id: 'c1', code: 'C1', name: roll.customerName },
        branch: null,
        candidateOrders: [],
        returnGradingEnabled: false,
      },
    };
  }
  if (url.startsWith('/rolls/barcode/')) {
    // İç barkod araması: müşteri kodunu TANIMAZ.
    const own = ROLLS[decodeURIComponent(url.slice('/rolls/barcode/'.length))];
    if (!own) notFound();
    return { success: true, data: { id: own.id, barcode: own.barcode } };
  }
  if (url.startsWith('/returns/reasons')) return { success: true, data: [] };
  return { success: true, data: [] };
}

jest.mock('../../services/api', () => ({
  apiClient: {
    get: (url: string) => mockGet(url),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
  isWorkSessionLost: () => false,
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../ScreenChrome', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => children }));
// Görünür tarayıcı başlığıyla bir "okut" düğmesi çizer (taşıma dalının hedef top okutması).
jest.mock('../BarcodeScannerModal', () => {
  const RN = jest.requireActual('react-native');
  return {
    BarcodeScannerModal: (p: { visible: boolean; title?: string; onScan: (c: string) => void }) =>
      p.visible ? (
        <RN.Pressable testID={`fake-scan:${p.title ?? ''}`} onPress={() => p.onScan(mockScanCode)}>
          <RN.Text>okut</RN.Text>
        </RN.Pressable>
      ) : null,
  };
});
jest.mock('../RollPickerModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../LabelPrinter', () => ({ LabelPrinter: () => null }));
jest.mock('../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../hooks/useSackWeigh', () => ({
  useSackWeigh: () => ({ weigh: jest.fn(), busy: false, weighingId: null, sheet: null }),
}));
jest.mock('../../hooks/usePortraitLock', () => ({ usePortraitLock: () => undefined }));
jest.mock('../../hooks/useFeatureFlags', () => ({ useReturnGradingEnabled: () => false }));
jest.mock('../../store/deviceSettingsStore', () => ({
  // Elle barkod girişi açık: el okuyucu yerine metin alanından okutulur.
  useDeviceSettingsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ manualBarcodeEntry: true }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));

beforeEach(() => {
  mockWithSacks = false;
  mockGet.mockReset();
  mockGet.mockImplementation(async (url: string) => ({ data: fakeBackend(url) }));
});

describe('Çuval Düzelt — müşteri barkodu tek boğazdan', () => {
  function scan(code: string) {
    renderWithPaper(<CuvalDuzeltScreen />);
    fireEvent.changeText(screen.getByTestId('cuval-duzelt-barkod'), code);
    fireEvent(screen.getByTestId('cuval-duzelt-barkod'), 'submitEditing');
  }

  it('⭐ müşteri barkodu ACR500 → doğru top (H251030002) + "müşteri barkodu ile bulundu"', async () => {
    scan('ACR500');
    expect(await screen.findByText('H251030002')).toBeTruthy();
    expect(screen.getByTestId('musteri-kodu-eslesme')).toHaveTextContent('Müşteri barkodu ACR500 ile bulundu');
    expect(mockGet).toHaveBeenCalledWith('/shipping/locate-roll?barcode=ACR500');
  });

  it('iç barkod → eşleşme notu YOK (bugünkü görünüm)', async () => {
    scan('H251030001');
    expect(await screen.findByText('H251030001')).toBeTruthy();
    expect(screen.queryByTestId('musteri-kodu-eslesme')).toBeNull();
  });

  it('⭐ belirsiz MK77 → aday modalı; seçim İÇ barkodla yeniden çözülür', async () => {
    scan('MK77');
    expect(await screen.findByText(/"MK77" birden çok müşteride/)).toBeTruthy();
    expect(screen.queryByText('Acar Perde · 40.0 m')).toBeTruthy();
    fireEvent.press(screen.getByText('H251030002'));
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/shipping/locate-roll?barcode=H251030002'));
    await waitFor(() => expect(screen.queryByText(/"MK77" birden çok müşteride/)).toBeNull());
    expect(await screen.findByText('IN_STOCK')).toBeTruthy();
  });
});

describe('Çuval Düzelt — taşıma dalı (moveAmbiguous, D4-KUC3d)', () => {
  it('⭐ hedef topta belirsiz müşteri barkodu → aday modalı; seçim İÇ barkodla yeniden sorulur, taşıma onayı açılır', async () => {
    mockWithSacks = true;
    renderWithPaper(<CuvalDuzeltScreen />);
    fireEvent.changeText(screen.getByTestId('cuval-duzelt-barkod'), 'H251030001');
    fireEvent(screen.getByTestId('cuval-duzelt-barkod'), 'submitEditing');
    fireEvent.press(await screen.findByText('Başka Çuvala Taşı'));
    mockScanCode = 'MK77';
    fireEvent.press(screen.getByTestId('fake-scan:Hedef Çuvaldaki Bir Topu Okut'));
    expect(await screen.findByText(/"MK77" birden çok müşteride/)).toBeTruthy();
    fireEvent.press(screen.getByText('H251030002'));
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/shipping/locate-roll?barcode=H251030002'));
    expect(await screen.findByText('Top taşınsın mı?')).toBeTruthy();
  });
});

describe('İade Girişi — müşteri barkodu tek boğazdan', () => {
  async function scan(code: string) {
    renderWithPaper(<IadeGirisiScreen />);
    const input = await screen.findByPlaceholderText('Top barkodu gir…');
    fireEvent.changeText(input, code);
    fireEvent(input, 'submitEditing');
  }

  it('⭐ müşteri barkodu ACR500 → doğru top (H251030002) + eşleşme notu', async () => {
    await scan('ACR500');
    expect(await screen.findByText('H251030002')).toBeTruthy();
    expect(screen.getByTestId('musteri-kodu-eslesme')).toHaveTextContent('Müşteri barkodu ACR500 ile bulundu');
    expect(mockGet).toHaveBeenCalledWith('/returns/lookup?barcode=ACR500');
  });

  it('⭐ belirsiz MK77 → aday modalı; seçim İÇ barkodla yeniden sorulur', async () => {
    await scan('MK77');
    expect(await screen.findByText(/"MK77" birden çok müşteride/)).toBeTruthy();
    fireEvent.press(screen.getByText('H251030001'));
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/returns/lookup?barcode=H251030001'));
    expect(await screen.findByText('Acar Perde', { exact: false })).toBeTruthy();
  });
});
