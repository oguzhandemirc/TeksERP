// =============================================================================
// T3 bekçisi — Depo ekranında emanet (müşteri malı) görünürlüğü
// =============================================================================
// Kabul: emanet AÇIK → "Sahip" süzgeci (Tümü/Bizim/Emanet) çizilir, seçim liste + şerit + kapsam
// isteklerine `filter[mulkiyet]` olarak gider (süzme SUNUCUDA), sahipli satırda "Emanet · ad" rozeti.
// Emanet KAPALI → süzgeç ve rozet yok, hiçbir istek `mulkiyet` taşımaz (bugünkü ekran/istek).
// =============================================================================
import React, { type ReactNode } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import DepoScreen from './DepoScreen';

const mockGet = jest.fn();
let mockEmanet = true;

jest.mock('../../../hooks/useFeatureFlags', () => ({
  ...jest.requireActual('../../../hooks/useFeatureFlags'),
  useEmanetEnabled: () => mockEmanet,
}));
jest.mock('../../../services/api', () => ({
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
jest.mock('../../../components/ScreenChrome', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => children }));
jest.mock('../../../components/BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../../hooks/useScanSeries', () => ({
  useScanClassifier: () => ({ classify: () => ({ kind: 'UNKNOWN' }), matchesFullFormat: () => false, resolveOnServer: jest.fn(), classifyOrAsk: async () => ({ kind: 'ROLL' }) }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));

const row = (id: string, owner: { id: string; name: string } | null) => ({
  id, barcode: `T${id}`, itemId: 'i1', item: { id: 'i1', name: 'Tül' }, color: null, status: 'WAREHOUSE',
  currentQty: 40, initialQty: 40, width: 280, qualityGrade: null, variantId: null,
  ownerCustomerId: owner?.id ?? null, ownerCustomer: owner,
});
const ROWS = [row('1', null), row('2', { id: 'c1', name: 'Akın Tekstil' })];

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/rolls/stats')) return { data: { success: true, data: { totalCount: 2, totalQty: 80, totalWeight: 0, byStatus: {}, byQuality: {} } } };
    if (url.startsWith('/rolls/warehouse-scope')) return { data: { success: true, data: { free: { count: 2, qty: 80 }, pool: { count: 0, qty: 0 }, planned: { count: 0, qty: 0 } } } };
    if (url.startsWith('/rolls?') || url === '/rolls') return { data: { success: true, data: ROWS, pagination: { hasMore: false, nextCursor: null } } };
    return { data: { success: true, data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 0 }, pagination: { hasMore: false, nextCursor: null } } };
  });
});

const urls = (prefix: string) => mockGet.mock.calls.map((c) => decodeURIComponent(c[0] as string)).filter((u) => u.startsWith(prefix));

it('emanet KAPALI: süzgeç ve rozet yok, istekler mulkiyet taşımaz (bugünkü ekran)', async () => {
  mockEmanet = false;
  renderWithPaper(<DepoScreen />);
  expect(await screen.findByText('T2')).toBeTruthy();
  expect(screen.queryByTestId('depo-owner-filter')).toBeNull();
  expect(screen.queryByTestId('owner-badge')).toBeNull();
  expect(mockGet.mock.calls.some((c) => /mulkiyet/.test(decodeURIComponent(c[0] as string)))).toBe(false);
  expect(urls('/rolls/warehouse-scope')).toEqual(expect.arrayContaining(['/rolls/warehouse-scope']));
});

it('emanet AÇIK: sahipli satırda rozet; "Emanet" seçimi liste + şerit + kapsam isteğine sunucu süzgeci olarak gider', async () => {
  mockEmanet = true;
  renderWithPaper(<DepoScreen />);
  expect(await screen.findByText('Akın Tekstil')).toBeTruthy();
  expect(screen.getAllByTestId('owner-badge')).toHaveLength(1);
  expect(screen.getByTestId('depo-owner-filter')).toBeTruthy();
  // Varsayılan Tümü: henüz mulkiyet yok.
  expect(mockGet.mock.calls.some((c) => /mulkiyet/.test(decodeURIComponent(c[0] as string)))).toBe(false);

  await act(async () => {
    fireEvent.press(screen.getByTestId('depo-owner-CONSIGNED'));
  });
  await waitFor(() => {
    expect(urls('/rolls?').some((u) => u.includes('filter[mulkiyet]=CONSIGNED'))).toBe(true);
    expect(urls('/rolls/stats').some((u) => u.includes('filter[mulkiyet]=CONSIGNED'))).toBe(true);
    expect(urls('/rolls/warehouse-scope')).toContain('/rolls/warehouse-scope?filter[mulkiyet]=CONSIGNED');
  });
  // Sekme seti korunur (yalnız mulkiyet eklenir).
  expect(urls('/rolls?').filter((u) => u.includes('mulkiyet=CONSIGNED')).every((u) => u.includes('filter[statusIn]=WAREHOUSE,A1_STOCK,STOCK'))).toBe(true);
});

it('emanet kapanınca seçim ALL\'a sıfırlanır; yeniden açılınca "Emanet" geri gelmez', async () => {
  mockEmanet = true;
  const r = renderWithPaper(<DepoScreen />);
  await screen.findByText('Akın Tekstil');
  await act(async () => {
    fireEvent.press(screen.getByTestId('depo-owner-CONSIGNED'));
  });
  await waitFor(() => expect(urls('/rolls?').some((u) => u.includes('filter[mulkiyet]=CONSIGNED'))).toBe(true));
  expect(screen.getByTestId('depo-owner-CONSIGNED').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

  mockEmanet = false;
  r.rerender(<DepoScreen />);
  await waitFor(() => expect(screen.queryByTestId('depo-owner-filter')).toBeNull());

  mockGet.mockClear();
  mockEmanet = true;
  r.rerender(<DepoScreen />);
  await screen.findByTestId('depo-owner-filter');
  expect(screen.getByTestId('depo-owner-ALL').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  expect(screen.getByTestId('depo-owner-CONSIGNED').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
  expect(mockGet.mock.calls.some((c) => /mulkiyet/.test(decodeURIComponent(c[0] as string)))).toBe(false);
});

it('Sahip çipleri ≥56dp dokunma hedefi', async () => {
  mockEmanet = true;
  renderWithPaper(<DepoScreen />);
  await screen.findByTestId('depo-owner-filter');
  for (const k of ['ALL', 'OWN', 'CONSIGNED']) {
    const flat = Object.assign({}, ...[screen.getByTestId(`depo-owner-${k}`).props.style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(56);
  }
});
