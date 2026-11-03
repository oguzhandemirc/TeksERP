// "İş emri oluştur" seçicisi (K6, panel aynası): sabit türler + özel iş emri kısayolları; kısayol → rota ön seçili form + "Belge okut".
import React, { type ReactNode } from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import WoCreateScreen from './WoCreateScreen';

const mockShortcuts = jest.fn();
let mockVisible: { key: string }[] = [{ key: 'HizliIsEmri' }, { key: 'GelenBelge' }];
let mockScan = false;
jest.mock('../../../../hooks/useFeatureFlags', () => ({ ...jest.requireActual('../../../../hooks/useFeatureFlags'), useScanRouteMode: () => mockScan }));

jest.mock('../../../../services/route.service', () => ({ routeService: { getShortcuts: () => mockShortcuts() } }));
jest.mock('../../../../hooks/useVisibleScreens', () => ({ useVisibleScreens: () => ({ visibleScreens: mockVisible }) }));
jest.mock('../../../../components/ScreenChrome', () => {
  const { Text, View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ title, children }: { title: string; children: ReactNode }) => (
      <View>
        <Text testID="baslik">{title}</Text>
        {children}
      </View>
    ),
  };
});
jest.mock('../../HizliIsEmri/NewWorkOrderView', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { initialRouteTemplateId?: string | null }) => <Text testID="hizli-form">{`rota:${p.initialRouteTemplateId ?? 'yok'}`}</Text> };
});
jest.mock('./DocBatchView', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { route: { id: string }; multi: boolean; autoStart: boolean }) => <Text testID="belge-okut-gorunumu">{`${p.route.id}:${p.multi ? 'cok' : 'tek'}:${p.autoStart}`}</Text> };
});
jest.mock('../desk/DeskView', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { shortcuts: { id: string }[] }) => <Text testID="belge-masasi">{p.shortcuts.map((r) => r.id).join(',')}</Text> };
});
jest.mock('../DocScanScreen', () => {
  const { Text } = jest.requireActual('react-native');
  return { DocScanBody: () => <Text testID="eski-belge-tara">eski</Text> };
});

const route = (id: string, name: string, order: number, shortcut = true) => ({ id, name, isWorkOrderShortcut: shortcut, shortcutOrder: order, isActive: true });

beforeEach(() => {
  useDeviceSettingsStore.setState({ docDeskDevice: false });
  mockVisible = [{ key: 'HizliIsEmri' }, { key: 'GelenBelge' }];
  mockShortcuts.mockReset();
  mockScan = false;
});

describe('WoCreateScreen — K29 S14b rotasız seçenek', () => {
  it('⭐ Okutmayla: "Sahada belirlenir (rotasız)" özel satırda İLK; seçince elle form yok, Belge okut rotasız görünümü açar', async () => {
    mockScan = true;
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-ozel-turler')).toBeTruthy());
    expect(s.getAllByLabelText(/rotasız|iş emri$/).map((n) => n.props.accessibilityLabel)).toEqual(['Sahada belirlenir (rotasız)', 'Kurşun&Tambur terbiye iş emri']);
    fireEvent.press(s.getByTestId('ie-rotasiz'));
    expect(s.getByTestId('ie-rotasiz-ipucu')).toBeTruthy();
    expect(s.queryByTestId('hizli-form')).toBeNull();
    fireEvent.press(s.getByTestId('ie-belge-okut'));
    expect(s.getByTestId('belge-okut-gorunumu').props.children).toBe('scan-routed:tek:true');
  });

  it('⭐ Okutmayla + kısayol yok: rotasız karo ve belge masası (rotasız başta) çıkar', async () => {
    mockScan = true;
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    expect(await s.findByTestId('ie-rotasiz')).toBeTruthy();
    fireEvent.press(s.getByTestId('ie-tur-belge-masasi'));
    expect(s.getByTestId('belge-masasi').props.children).toBe('scan-routed');
  });

  it('Sıralı (varsayılan): rotasız karo yok', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-ozel-turler')).toBeTruthy());
    expect(s.queryByTestId('ie-rotasiz')).toBeNull();
  });
});

describe('WoCreateScreen', () => {
  it('⭐ iki satır: sabit tür + özel iş emirleri (sıralı); kısayol varken eski Belge Tara gösterilmez', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r2', 'Brode', 2), route('r1', 'Kurşun&Tambur', 1), route('r3', 'Normal', 0, false)] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-ozel-turler')).toBeTruthy());
    expect(s.getByTestId('ie-tur-hizli')).toBeTruthy();
    expect(s.queryByTestId('ie-tur-belge-tara')).toBeNull();
    expect(s.queryByTestId('kisayol-Normal')).toBeNull();
    const labels = s.getAllByLabelText(/iş emri$/).map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual(['Kurşun&Tambur terbiye iş emri', 'Brode terbiye iş emri']);
  });

  it('⭐ kısayol → DOĞRUDAN form: rota ön seçili, başlık "<ad> iş emri", üstte Belge okut', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('kisayol-Kurşun&Tambur'));
    expect(s.getByTestId('hizli-form').props.children).toBe('rota:r1');
    expect(s.getByTestId('baslik').props.children).toBe('Kurşun&Tambur terbiye iş emri');
    fireEvent.press(s.getByTestId('ie-belge-okut'));
    expect(s.getByTestId('belge-okut-gorunumu').props.children).toBe('r1:tek:true');
  });

  it('"Birden çok belge" toplu görünümü açar', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('kisayol-Kurşun&Tambur'));
    fireEvent.press(s.getByTestId('ie-birden-cok-belge'));
    expect(s.getByTestId('belge-okut-gorunumu').props.children).toBe('r1:cok:true');
  });

  it('kısayol yok (eski sunucu) → 2. satır gizli, bugünkü Belge Tara yolu kalır; Hızlı İE rota ön seçimsiz', async () => {
    mockShortcuts.mockResolvedValue({ data: [{ id: 'r9', name: 'Eski' }] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('ie-tur-belge-tara'));
    expect(s.getByTestId('eski-belge-tara')).toBeTruthy();
  });

  it('Hızlı İE düz: rota ön seçimi yok, Belge okut çubuğu yok', async () => {
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-tur-belge-tara')).toBeTruthy());
    expect(s.queryByTestId('ie-ozel-turler')).toBeNull();
    fireEvent.press(s.getByTestId('ie-tur-hizli'));
    expect(s.getByTestId('hizli-form').props.children).toBe('rota:yok');
    expect(s.queryByTestId('ie-belge-okut')).toBeNull();
  });

  it('Hızlı İE yetkisi yoksa sabit tür gösterilmez; kısayolda form yerine not, Belge okut kalır', async () => {
    mockVisible = [{ key: 'GelenBelge' }];
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('kisayol-Kurşun&Tambur'));
    expect(s.queryByTestId('hizli-form')).toBeNull();
    expect(s.getByTestId('ie-belge-okut')).toBeTruthy();
  });
  it('⭐ K23 "Belge masası" karosu (kısayol varsa) → masa kipi kısayollarla; geri → seçici', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1), route('r2', 'Kurşun&DetayKK', 2)] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('ie-tur-belge-masasi'));
    expect(s.getByTestId('belge-masasi').props.children).toBe('r1,r2');
    expect(s.getByTestId('baslik').props.children).toBe('Belge masası');
  });

  it('K23 kısayol yoksa masa karosu yok; cihaz ayarı kapalıyken (varsayılan) seçici açılır', async () => {
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-tur-belge-tara')).toBeTruthy());
    expect(s.queryByTestId('ie-tur-belge-masasi')).toBeNull();
    expect(s.queryByTestId('belge-masasi')).toBeNull();
  });

  it('⭐ K23 "Bu cihaz belge masası" açık → kısayollar gelince doğrudan masa kipi', async () => {
    useDeviceSettingsStore.setState({ docDeskDevice: true });
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    expect(await s.findByTestId('belge-masasi')).toBeTruthy();
  });
});
