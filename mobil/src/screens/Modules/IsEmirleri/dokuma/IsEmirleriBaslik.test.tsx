// İş Emirleri başlığı: dokuma kapalıyken DÜZ METİN "İş Emirleri" (düğme yok); açıkken "[Terbiye] / Dokuma" anahtarı,
// pasife dokununca Dokuma listesi gelir ve seçim cihazda saklanır. Liste/sheet/servisler sahte — ölçülen başlık bağlamasıdır.
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { terimDokumaAyarla } from '../../../../lib/terim';
import IsEmirleriScreen from '../IsEmirleriScreen';

let mockFlags: { productionEnabled: boolean; dokumaEnabled: boolean } | undefined;
let mockPerms: string[] = [];
const mockStore = new Map<string, string>();

jest.mock('../../../../hooks/useFeatureFlags', () => ({
  // Gerçek hook gibi: rejim çizimden önce uygulanır (K20).
  useFeatureFlags: () => {
    jest.requireActual('../../../../lib/terim-rejim').applyTermRegime(mockFlags);
    return { data: mockFlags };
  },
}));
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: (c: string) => mockPerms.includes(c) }) }));
jest.mock('../../../../utils/storage', () => ({
  storage: {
    getItem: (k: string) => Promise.resolve(mockStore.get(k) ?? null),
    setItem: (k: string, v: string) => { mockStore.set(k, v); return Promise.resolve(); },
  },
}));
jest.mock('../../../../components/ScreenChrome', () => {
  const { Text: T, View } = jest.requireActual('react-native');
  return function MockChrome({ title, titleRowExtras, children }: { title: string; titleRowExtras?: React.ReactNode; children: React.ReactNode }) {
    return (
      <View>
        {title ? <T testID="baslik-metni">{title}</T> : null}
        {titleRowExtras}
        {children}
      </View>
    );
  };
});
jest.mock('../useWorkOrderList', () => ({
  useWorkOrderList: () => ({ rows: [], total: 0, problem: null, loading: false, refreshing: false, fetchingMore: false, searching: false, loadMore: jest.fn(), refetch: jest.fn() }),
  useLocationStations: () => ({ stations: [], loading: false }),
  useColumnPrefs: () => ({ visible: [], toggle: jest.fn() }),
}));
jest.mock('../useScanAction', () => ({ useScanAction: () => ({ available: false, groups: [], type: null, loading: false, select: jest.fn() }) }));
jest.mock('../FilterBar', () => () => null);
jest.mock('../WorkOrderTable', () => function MockTerbiye() {
  const { Text: T } = jest.requireActual('react-native');
  return <T>TERBIYE-LISTE</T>;
});
jest.mock('../ColumnsSheet', () => () => null);
jest.mock('../ActionBar', () => () => null);
jest.mock('../ScanStage', () => () => null);
jest.mock('../../HizliIsEmri/WorkOrderDetailSheet', () => () => null);
jest.mock('./DokumaListesi', () => function MockDokuma() {
  const { Text: T } = jest.requireActual('react-native');
  return <T>DOKUMA-LISTE</T>;
});

beforeEach(() => {
  mockStore.clear();
  mockPerms = ['mobile:hizli-is-emri', 'mobile:dokuma'];
});
afterEach(() => terimDokumaAyarla(true));

describe('İş Emirleri başlığı (Terbiye / Dokuma)', () => {
  it('dokuma KAPALI → düz metin "İş Emirleri", anahtar yok, terbiye listesi', async () => {
    mockFlags = { productionEnabled: true, dokumaEnabled: false };
    renderWithPaper(<IsEmirleriScreen />);
    await act(async () => undefined);
    expect(screen.getByTestId('baslik-metni').props.children).toBe('İş Emirleri');
    expect(screen.queryByTestId('ie-tur-terbiye')).toBeNull();
    expect(screen.queryByText(/Terbiye/)).toBeNull();
    expect(screen.getByText('TERBIYE-LISTE')).toBeTruthy();
  });

  it('dokuma KAPALI iken kayıtlı "dokuma" seçimi yok sayılır', async () => {
    mockFlags = { productionEnabled: true, dokumaEnabled: false };
    mockStore.set('device_is_emri_turu', 'dokuma');
    renderWithPaper(<IsEmirleriScreen />);
    await act(async () => undefined);
    expect(screen.getByText('TERBIYE-LISTE')).toBeTruthy();
    expect(screen.queryByText('DOKUMA-LISTE')).toBeNull();
  });

  it('dokuma açık ama okuma izni yok → tek başlık (rejim adı), anahtar yok', async () => {
    mockFlags = { productionEnabled: true, dokumaEnabled: true };
    mockPerms = ['mobile:hizli-is-emri'];
    renderWithPaper(<IsEmirleriScreen />);
    await act(async () => undefined);
    expect(screen.getByTestId('baslik-metni').props.children).toBe('Terbiye İş Emirleri');
    expect(screen.queryByTestId('ie-tur-dokuma')).toBeNull();
  });

  it('dokuma AÇIK → anahtar; pasife dokununca Dokuma listesi, adlar yerinde, seçim saklanır', async () => {
    mockFlags = { productionEnabled: true, dokumaEnabled: true };
    renderWithPaper(<IsEmirleriScreen />);
    await act(async () => undefined);
    expect(screen.queryByTestId('baslik-metni')).toBeNull();
    expect(screen.getByTestId('ie-tur-terbiye').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('TERBIYE-LISTE')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ie-tur-dokuma'));
    await waitFor(() => expect(screen.getByText('DOKUMA-LISTE')).toBeTruthy());
    expect(screen.getByTestId('ie-tur-dokuma').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('Terbiye İş Emirleri')).toBeTruthy();
    expect(screen.getByText('Dokuma İş Emirleri')).toBeTruthy();
    expect(mockStore.get('device_is_emri_turu')).toBe('dokuma');
  });

  it('kayıtlı "dokuma" seçimi açılışta geri gelir', async () => {
    mockFlags = { productionEnabled: true, dokumaEnabled: true };
    mockStore.set('device_is_emri_turu', 'dokuma');
    renderWithPaper(<IsEmirleriScreen />);
    await waitFor(() => expect(screen.getByText('DOKUMA-LISTE')).toBeTruthy());
  });
});
