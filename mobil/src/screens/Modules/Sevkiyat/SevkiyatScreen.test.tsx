// =============================================================================
// Bekçi: Sevk Çıkışı giriş ekranı (el terminali M1, 2026-11-11)
// =============================================================================
// Kilitlenen sözleşme:
//   • "Sevke hazır işler" şeridi her kurulumda YOK,
//   • arama kutusu sabit değil: büyüteç açar, ikinci basış kapatır ve metni temizler (board süzgeçsiz döner),
//   • `shipmentHandheldCreateEnabled` kapalı/eksik → board bugünkü gibi, v2 listesi/"Yeni Sevk" YOK,
//   • bayrak açık → v2 listesi (`/shipping/shipments?mode=cursor`), altta "Yeni Sevk" → cari seçimi; süzgeç sunucuya gider,
//   • bayrak açık + çuvalsız sevk kapalı → "Yeni Sevk" kilitli + bilgi şeridi (çıkışsız düğme yok).
// Negatif sonda: DEFAULT_FEATURE_FLAGS.shipmentHandheldCreateEnabled=true → "eski backend" testi kırmızı.
// =============================================================================
import React, { type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { useAuthStore } from '../../../store/authStore';
import SevkiyatScreen from './SevkiyatScreen';

const mockGet = jest.fn();
const mockNavigate = jest.fn();
let mockFlags: Record<string, unknown> = {};

jest.mock('../../../services/api', () => ({
  apiClient: { get: (url: string) => mockGet(url), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  isWorkSessionLost: () => false,
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../components/ScreenChrome', () => ({
  __esModule: true,
  default: ({ children, headerExtras }: { children: ReactNode; headerExtras?: ReactNode }) => (
    <>
      {headerExtras}
      {children}
    </>
  ),
}));
// Sheet animasyonsuz düz ağaç olarak (portal + animasyon testte dokunuşu yutar).
jest.mock('../../../components/ModuleSheet', () => ({
  __esModule: true,
  default: (p: { visible: boolean; children: ReactNode; footer?: ReactNode; overlays?: ReactNode }) =>
    p.visible ? (
      <>
        {p.children}
        {p.footer}
        {p.overlays}
      </>
    ) : null,
  SheetField: () => null,
  sheet: {},
}));
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('./LoadAddFlow', () => ({ LoadAddFlow: () => null }));
jest.mock('../../../hooks/usePortraitLock', () => ({ usePortraitLock: () => undefined }));

const C_READY = '11111111-1111-4111-8111-111111111111';
const C_OTHER = '22222222-2222-4222-8222-222222222222';

function fakeBackend(url: string) {
  if (url.startsWith('/feature-flags')) return { success: true, data: mockFlags };
  if (url.startsWith('/shipping/shipments?')) {
    return { success: true, data: [], pagination: { hasMore: false, nextCursor: null } };
  }
  if (url.startsWith('/shipping/sack-store/board')) {
    return { success: true, data: [], pagination: { hasMore: false, nextCursor: null } };
  }
  if (url.startsWith('/shipping/ready-works')) {
    return {
      success: true,
      data: {
        items: [
          {
            unit: 'customer', id: C_READY, label: 'HH Tekstil', customerId: C_READY, customerName: 'HH Tekstil', state: 'READY',
            readyCount: 4, readyMeters: 130, inProcessCount: 0, inProcessMeters: 0, shippedMeters: 0, targetMeters: null,
          },
        ],
        nextCursor: null,
      },
    };
  }
  if (url.startsWith('/customers/') && url.endsWith('/branches')) return { success: true, data: [] };
  if (url.startsWith('/customers')) {
    return {
      success: true,
      data: [
        { id: C_READY, code: 'HH', name: 'HH Tekstil', isActive: true },
        { id: C_OTHER, code: 'DM', name: 'Demir Örme', isActive: true },
      ],
      pagination: { page: 1, pageSize: 500, total: 2, totalPages: 1 },
    };
  }
  return { success: true, data: [] };
}

beforeEach(() => {
  mockGet.mockReset();
  mockNavigate.mockReset();
  mockGet.mockImplementation(async (url: string) => ({ data: fakeBackend(url) }));
  mockFlags = { shipmentLooseLoadEnabled: true, customerBranchesEnabled: false };
  useAuthStore.setState({ token: 't' } as never);
});

const boardCalls = () => mockGet.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/shipping/sack-store/board'));
const flagsLoaded = () => waitFor(() => expect(mockGet.mock.calls.some((c) => String(c[0]).startsWith('/feature-flags'))).toBe(true));

describe('Sevk Çıkışı — şerit ve arama', () => {
  it('"Sevke hazır işler" şeridi yok', async () => {
    renderWithPaper(<SevkiyatScreen />);
    await screen.findByTestId('sevk-bos');
    expect(screen.queryByTestId('hazir-is-serit')).toBeNull();
    expect(screen.queryByText('Sevke hazır işler')).toBeNull();
  });

  it('kutu kapalı başlar; büyüteç açar, ikinci basış kapatır ve arama boşalır', async () => {
    renderWithPaper(<SevkiyatScreen />);
    await screen.findByTestId('sevk-bos');
    expect(screen.queryByTestId('sevk-arama-kutu')).toBeNull();

    fireEvent.press(screen.getByTestId('sevk-arama-ac'));
    const box = await screen.findByTestId('sevk-arama-kutu');
    fireEvent.changeText(box, 'SVK-7');
    await waitFor(() => expect(boardCalls().some((u) => u.includes('search=SVK-7'))).toBe(true));

    fireEvent.press(screen.getByTestId('sevk-arama-ac'));
    await waitFor(() => expect(screen.queryByTestId('sevk-arama-kutu')).toBeNull());
    // Yeniden açılınca boş; board süzgeçsiz isteğe döner.
    fireEvent.press(screen.getByTestId('sevk-arama-ac'));
    expect((await screen.findByTestId('sevk-arama-kutu')).props.value).toBe('');
    await waitFor(() => expect(boardCalls().at(-1)).not.toContain('search='));
  });
});

const listCalls = () => mockGet.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/shipping/shipments?'));

describe('Sevk Çıkışı — el terminali v2 (bayraklı)', () => {
  it('eski backend (bayrak alanı yok) → board; v2 listesi ve Yeni Sevk yok', async () => {
    renderWithPaper(<SevkiyatScreen />);
    await flagsLoaded();
    await screen.findByTestId('sevk-bos');
    expect(screen.queryByTestId('sevk-yeni')).toBeNull();
    expect(listCalls()).toHaveLength(0);
  });

  it('bayrak false → board; Yeni Sevk yok', async () => {
    mockFlags = { ...mockFlags, shipmentHandheldCreateEnabled: false };
    renderWithPaper(<SevkiyatScreen />);
    await flagsLoaded();
    await screen.findByTestId('sevk-bos');
    expect(screen.queryByTestId('sevk-yeni')).toBeNull();
  });

  it('bayrak açık → v2 listesi cursor ile; Yeni Sevk cari seçimine gider; şerit yok', async () => {
    mockFlags = { ...mockFlags, shipmentHandheldCreateEnabled: true };
    renderWithPaper(<SevkiyatScreen />);
    await screen.findByTestId('sevk-liste-bos');
    expect(listCalls()[0]).toContain('mode=cursor');
    expect(screen.queryByTestId('hazir-is-serit')).toBeNull();
    const btn = screen.getByTestId('sevk-yeni');
    expect(StyleSheet.flatten(btn.props.style)).toEqual(expect.objectContaining({ minHeight: 56 }));
    fireEvent.press(btn);
    expect(mockNavigate).toHaveBeenCalledWith('SevkCariSec');
  });

  it('bayrak açık: arama ve süzgeç sunucuya gider', async () => {
    mockFlags = { ...mockFlags, shipmentHandheldCreateEnabled: true };
    renderWithPaper(<SevkiyatScreen />);
    await screen.findByTestId('sevk-liste-bos');
    fireEvent.press(screen.getByTestId('sevk-arama-ac'));
    fireEvent.changeText(await screen.findByTestId('sevk-arama-kutu'), 'SVK-9');
    await waitFor(() => expect(listCalls().some((u) => u.includes('search=SVK-9'))).toBe(true));

    fireEvent.press(screen.getByTestId('sevk-suzgec-ac'));
    fireEvent.press(await screen.findByTestId('sevk-suzgec-durum-PLANNED'));
    fireEvent.press(screen.getByTestId('sevk-suzgec-sira-customer'));
    fireEvent.press(screen.getByTestId('sevk-suzgec-uygula'));
    await waitFor(() => {
      const last = listCalls().at(-1) ?? '';
      expect(last).toContain('status=PLANNED');
      expect(last).toContain('sortBy=customerName');
    });
  });

  it('bayrak açık + çuvalsız sevk kapalı → Yeni Sevk kilitli, bilgi şeridi', async () => {
    mockFlags = { shipmentHandheldCreateEnabled: true, shipmentLooseLoadEnabled: false };
    renderWithPaper(<SevkiyatScreen />);
    expect(await screen.findByText(/Çuvalsız sevk kapalı/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('sevk-yeni'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
