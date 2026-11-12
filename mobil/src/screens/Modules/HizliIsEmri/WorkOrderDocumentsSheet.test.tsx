// Belgeler modalı: açıklama şeridi yok, satır yalnız ad · no (+ tarih), eylemler 56dp ikon düğmesi, kâğıt boyu işlevi korunur.
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { IconButton } from 'react-native-paper';
import { renderWithPaper } from '../../../test/render';
import WorkOrderDocumentsSheet from './WorkOrderDocumentsSheet';

const mockList = jest.fn();
const mockPrint = jest.fn();
jest.mock('../../../services/workOrderDocuments', () => ({
  workOrderDocumentService: { list: (...a: unknown[]) => mockList(...a) },
  printDocument: (...a: unknown[]) => mockPrint(...a),
}));
const mockOpen = jest.fn();
jest.mock('./useIncomingScans', () => ({
  useIncomingScans: () => ({
    items: [{ scanId: 's1', title: 'Gelen belge · GB0911260073', subtitle: '', viewable: true, blockedReason: null }],
    openingId: null,
    open: (...a: unknown[]) => mockOpen(...a),
    viewer: null,
  }),
}));
const mockSet = jest.fn(() => Promise.resolve());
const mockClear = jest.fn(() => Promise.resolve());
let mockSizes: Record<string, string> = {};
jest.mock('../../../store/deviceSettingsStore', () => ({
  useDeviceSettingsStore: (sel: (s: unknown) => unknown) => sel({ docPageSize: mockSizes, setDocPageSize: mockSet, clearDocPageSize: mockClear }),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const DOC = { docType: 'TRAVELER_CARD', sourceId: 'w1', group: 'İş Emri Belgeleri', title: 'Refakat Kartı', documentNo: 'IE0911260004', subtitle: 'v1 · Üretim sahasında topla birlikte dolaşır', date: '2026-11-09T10:00:00.000Z', cancelled: false };

function renderIt() {
  return renderWithPaper(<WorkOrderDocumentsSheet visible onDismiss={jest.fn()} workOrderId="w1" workOrderNumber="IE0911260004" />);
}

const flat = (style: unknown) => Object.assign({}, ...[style].flat(5).filter(Boolean));

describe('WorkOrderDocumentsSheet', () => {
  beforeEach(() => {
    mockList.mockResolvedValue({ data: { workOrderNumber: 'IE0911260004', documents: [DOC] } });
    mockPrint.mockReset().mockResolvedValue(undefined);
    mockOpen.mockReset();
    mockSet.mockClear();
    mockClear.mockClear();
    mockSizes = {};
  });

  it('⭐ açıklama şeridi ve alt açıklama yok; satır ad · no + kısa tarih', async () => {
    renderIt();
    await waitFor(() => expect(screen.getByText('Refakat Kartı · IE0911260004')).toBeTruthy());
    expect(screen.getByText('Gelen belge · GB0911260073')).toBeTruthy();
    expect(screen.queryByText(/dokun → tam ekran/)).toBeNull();
    expect(screen.queryByText(/Üretim sahasında/)).toBeNull();
    expect(screen.queryByText('Tek sayfa')).toBeNull();
    expect(screen.getByText('09.11.2026')).toBeTruthy();
  });

  it('⭐ kartın yatay kenar boşluğu ≥16dp; eylem düğmeleri ≥56dp', async () => {
    renderIt();
    await waitFor(() => expect(screen.getByTestId('ie-belge-yazdir-TRAVELER_CARD-w1')).toBeTruthy());
    expect(flat(screen.getByTestId('ie-belge-TRAVELER_CARD-w1').props.style).marginHorizontal).toBeGreaterThanOrEqual(16);
    expect(flat(screen.getByTestId('ie-gelen-belge-s1').props.style).marginHorizontal).toBeGreaterThanOrEqual(16);
    const btns = screen.UNSAFE_getAllByType(IconButton);
    for (const id of ['ie-belge-yazdir-TRAVELER_CARD-w1', 'ie-belge-boyut-TRAVELER_CARD-w1', 'ie-gelen-belge-ac-s1']) {
      const st = flat(btns.find((b) => b.props.testID === id)?.props.style);
      expect(st.width ?? st.minWidth).toBeGreaterThanOrEqual(56);
      expect(st.height ?? st.minHeight).toBeGreaterThanOrEqual(56);
    }
  });

  it('⭐ yazdır ikonu basar (cihaz kâğıt boyuyla); büyüteç gelen belgeyi açar', async () => {
    mockSizes = { TRAVELER_CARD: 'A5' };
    renderIt();
    await waitFor(() => expect(screen.getByTestId('ie-belge-yazdir-TRAVELER_CARD-w1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('ie-belge-yazdir-TRAVELER_CARD-w1'));
    await waitFor(() => expect(mockPrint).toHaveBeenCalledWith(expect.objectContaining({ docType: 'TRAVELER_CARD' }), 'A5'));
    fireEvent.press(screen.getByTestId('ie-gelen-belge-ac-s1'));
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ scanId: 's1' }));
  });

  it('⭐ ayar ikonu kâğıt boyunu üç durumda döndürür (belge ayarı → A4 → A5 → belge ayarı); seçim küçük yazar', async () => {
    renderIt();
    await waitFor(() => expect(screen.getByTestId('ie-belge-boyut-TRAVELER_CARD-w1')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('ie-belge-boyut-TRAVELER_CARD-w1')); });
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('TRAVELER_CARD', 'A4'));
    expect(mockPrint).not.toHaveBeenCalled();
    screen.unmount();
    mockSizes = { TRAVELER_CARD: 'A5' };
    renderIt();
    await waitFor(() => expect(screen.getByText('A5')).toBeTruthy());
    fireEvent.press(screen.getByTestId('ie-belge-boyut-TRAVELER_CARD-w1'));
    await waitFor(() => expect(mockClear).toHaveBeenCalledWith('TRAVELER_CARD'));
  });
});
