// =============================================================================
// Bekçi: el terminali sevk okutma ekranı (M2, 2026-11-11)
// =============================================================================
// Kilitlenen sözleşme:
//   • hedef = okutma ANINDAKİ seçim: çuval seçiliyken okutma `targetSackId` taşır, seçimsizken null (çuvalsız),
//   • seçili çuval ✓ ikonu + `selected`; düğmeler ≥56dp,
//   • "çıkarılsın mı" sorusu onaylanınca AYNI barkod `confirmRemove:true` ile yeniden gider; soru okutma sinyali vermez,
//   • basılı tut → çuval içeriği; Sevk Et → özet onayı `expectedRollCount` = ekrandaki top sayısı → sonuçta irsaliye no,
//   • sevk edilmiş sevkiyat salt-okunur: Çuval Aç / Sevk Et yok, okuyucu tetiği kapalı.
// =============================================================================
import React, { type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { loadState, roll, sack } from '../../../test/handheldStateFixture';
import SevkOkutScreen from './SevkOkutScreen';

const mockGetState = jest.fn();
const mockScan = jest.fn();
const mockDispatch = jest.fn();
const mockSignal = jest.fn();
let mockScanHandler: ((s: { data: string }) => void) | null = null;
let mockScanActive: boolean | undefined;

jest.mock('../../../services/handheldShipment.service', () => ({
  ...jest.requireActual('../../../services/handheldShipment.service'),
  handheldShipmentService: {
    getState: (...a: unknown[]) => mockGetState(...a),
    scan: (...a: unknown[]) => mockScan(...a),
    dispatch: (...a: unknown[]) => mockDispatch(...a),
    openSack: jest.fn(),
    setSackWeight: jest.fn(),
  },
}));
jest.mock('../../../hooks/useHardwareScanTarget', () => ({
  useHardwareScanTarget: (h: (s: { data: string }) => void, o: { active?: boolean }) => {
    mockScanHandler = h;
    mockScanActive = o.active;
  },
}));
jest.mock('../../../services/scanFeedback', () => ({ signalScan: (k: string) => mockSignal(k) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { shipmentId: 'sh1', shipmentNo: 'SVK-1' } }),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../hooks/usePortraitLock', () => ({ usePortraitLock: () => undefined }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useMobileRasterEnabled: () => false }));
jest.mock('../../../components/BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../../../components/ScreenChrome', () => ({
  __esModule: true,
  default: ({ children, headerExtras }: { children: ReactNode; headerExtras?: ReactNode }) => (
    <>
      {headerExtras}
      {children}
    </>
  ),
}));
jest.mock('../../../components/ModuleSheet', () => ({
  __esModule: true,
  default: (p: { visible: boolean; title?: string; children: ReactNode; footer?: ReactNode }) => {
    const { Text } = jest.requireActual('react-native-paper');
    return p.visible ? (
      <>
        <Text>{p.title}</Text>
        {p.children}
        {p.footer}
      </>
    ) : null;
  },
  sheet: {},
}));

const S1 = sack('s1', [roll('r1')]);
const S2 = sack('s2', [roll('r2'), roll('r3')]);
const PLANNED = loadState({ sacks: [S1, S2], loose: [roll('r4')] });

beforeEach(() => {
  jest.clearAllMocks();
  mockScanHandler = null;
  mockGetState.mockResolvedValue(PLANNED);
});

async function scanCode(code: string) {
  await act(async () => {
    mockScanHandler?.({ data: code });
  });
}

describe('SevkOkut — okutma', () => {
  it('seçimsiz okutma çuvalsıza; çuval seçilince hedef o çuval, kartta ✓', async () => {
    mockScan.mockResolvedValue({ outcome: { kind: 'added', rollId: 'r9', barcode: 'T-9', to: { sackId: null, label: 'Çuvalsız' } }, state: PLANNED });
    renderWithPaper(<SevkOkutScreen />);
    await screen.findByTestId('sevk-cuval-ÇV-s1');
    expect(mockScanActive).toBe(true);
    expect(screen.getByTestId('sevk-hedef')).toHaveTextContent(/Çuvalsız/);

    await scanCode('T-9');
    await waitFor(() => expect(mockScan).toHaveBeenCalledWith('sh1', expect.objectContaining({ barcode: 'T-9', targetSackId: null })));
    expect(mockSignal).toHaveBeenCalledWith('accept');
    // Okutma sonrası satır olayı gösterir (hedef satırının yerine, 4 sn).
    expect(screen.getByTestId('sevk-olay')).toHaveTextContent(/T-9/);

    fireEvent.press(screen.getByTestId('sevk-cuval-ÇV-s2'));
    expect(screen.getByTestId('sevk-cuval-ÇV-s2').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

    await scanCode('T-10');
    await waitFor(() => expect(mockScan).toHaveBeenLastCalledWith('sh1', expect.objectContaining({ barcode: 'T-10', targetSackId: 's2' })));
    expect(StyleSheet.flatten(screen.getByTestId('sevk-et').props.style)).toEqual(expect.objectContaining({ minHeight: 56 }));
  });

  it('çıkar sorusu sinyalsiz; onay aynı barkodu confirmRemove ile yeniden gönderir', async () => {
    mockScan
      .mockResolvedValueOnce({ outcome: { kind: 'needsRemoveConfirm', rollId: 'r1', barcode: 'T-r1', from: { sackId: 's1', label: 'ÇV-s1' } }, state: PLANNED })
      .mockResolvedValueOnce({ outcome: { kind: 'removed', rollId: 'r1', barcode: 'T-r1', from: { sackId: 's1', label: 'ÇV-s1' }, unitDissolved: false }, state: PLANNED });
    renderWithPaper(<SevkOkutScreen />);
    await screen.findByTestId('sevk-cuval-ÇV-s1');
    fireEvent.press(screen.getByTestId('sevk-cuval-ÇV-s1'));
    await scanCode('T-r1');
    await screen.findByTestId('sevk-soru-onay');
    expect(mockSignal).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('sevk-soru-onay'));
    });
    await waitFor(() =>
      expect(mockScan).toHaveBeenLastCalledWith('sh1', expect.objectContaining({ barcode: 'T-r1', targetSackId: 's1', confirmRemove: true })),
    );
  });

  it('basılı tut → çuval içeriği', async () => {
    renderWithPaper(<SevkOkutScreen />);
    await screen.findByTestId('sevk-cuval-ÇV-s2');
    fireEvent(screen.getByTestId('sevk-cuval-ÇV-s2'), 'longPress');
    expect(await screen.findByTestId('sevk-cuval-icerik')).toBeTruthy();
    expect(screen.getAllByTestId('sevk-top-T-r3').length).toBeGreaterThan(0);
  });
});

describe('SevkOkut — sevk et', () => {
  it('özet onayı ekrandaki top sayısını yollar; sonuçta irsaliye no ve baskı düğmeleri', async () => {
    const done = loadState({ sacks: [S1, S2], loose: [roll('r4')], status: 'DISPATCHED', documentNo: 'IRS-77' });
    mockDispatch.mockResolvedValue({
      shipmentId: 'sh1', shipmentNo: 'SVK-1', documentNo: 'IRS-77', rollCount: 4, sackCount: 2, looseRollCount: 1, droppedEmptySacks: [], state: done,
    });
    renderWithPaper(<SevkOkutScreen />);
    fireEvent.press(await screen.findByTestId('sevk-et'));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('sevk-onay-gonder'));
    });
    expect(mockDispatch).toHaveBeenCalledWith('sh1', expect.objectContaining({ expectedRollCount: 4 }));
    expect(await screen.findByTestId('sevk-sonuc-irsaliye')).toHaveTextContent('IRS-77');
    expect(screen.getByTestId('sevk-sonuc-yazdir')).toBeTruthy();
    expect(screen.getByTestId('sevk-sonuc-etiket')).toBeTruthy();
  });

  it('sevk edilmiş sevkiyat salt-okunur', async () => {
    mockGetState.mockResolvedValue(loadState({ sacks: [S1], status: 'DISPATCHED', documentNo: 'IRS-1' }));
    renderWithPaper(<SevkOkutScreen />);
    await screen.findByTestId('sevk-irsaliye-yazdir');
    expect(screen.queryByTestId('sevk-et')).toBeNull();
    expect(screen.queryByTestId('sevk-cuval-ac')).toBeNull();
    expect(screen.queryByTestId('sevk-cuval-kg-ÇV-s1')).toBeNull();
    expect(mockScanActive).toBe(false);
  });
});
