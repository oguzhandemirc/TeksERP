// S16b `gelenBelge.tabletIeGirisi`: BELGE kipinde her karo tek formu açar (top/masa/Belge Tara gizli); TOP yalnız top yolu.
// IKISI = bugünkü ekran — `WoCreateScreen.test.tsx` onu değiştirilmeden ölçer.
import React, { type ReactNode } from 'react';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { useAuthStore } from '../../../../store/authStore';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import WoCreateScreen from './WoCreateScreen';

const mockShortcuts = jest.fn();
let mockEntry: { entry: 'IKISI' | 'BELGE' | 'TOP'; ready: boolean } = { entry: 'BELGE', ready: true };
let mockScan = false;
jest.mock('./useWoEntry', () => ({ useTabletWoEntry: () => mockEntry }));
jest.mock('../../../../hooks/useFeatureFlags', () => ({ ...jest.requireActual('../../../../hooks/useFeatureFlags'), useScanRouteMode: () => mockScan }));
jest.mock('../../../../services/route.service', () => ({ routeService: { getShortcuts: () => mockShortcuts() } }));
jest.mock('../../../../hooks/useVisibleScreens', () => ({ useVisibleScreens: () => ({ visibleScreens: [{ key: 'HizliIsEmri' }, { key: 'GelenBelge' }] }) }));
jest.mock('../../../../components/ScreenChrome', () => {
  const { Text, View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ title, children, profileExtras }: { title: string; children: ReactNode; profileExtras?: ReactNode }) => (
      <View>
        <Text testID="baslik">{title}</Text>
        <View testID="baslik-ekleri">{profileExtras}</View>
        {children}
      </View>
    ),
  };
});
jest.mock('./UnifiedWoForm', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { initialRoute: { id: string } | null; routeLocked: boolean; fieldsOpen?: boolean }) => (
      <>
        <Text testID="tek-form">{`${p.initialRoute?.id ?? 'yok'}:${p.routeLocked ? 'kilitli' : 'secilir'}`}</Text>
        <Text testID="tek-form-alanlar">{String(p.fieldsOpen)}</Text>
      </>
    ),
  };
});
jest.mock('../../HizliIsEmri/NewWorkOrderView', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { initialRouteTemplateId?: string | null }) => <Text testID="hizli-form">{`rota:${p.initialRouteTemplateId ?? 'yok'}`}</Text> };
});
jest.mock('./DocBatchView', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <Text testID="belge-okut-gorunumu">toplu</Text> };
});
jest.mock('../desk/DeskView', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <Text testID="belge-masasi">masa</Text> };
});
jest.mock('../DocScanScreen', () => {
  const { Text } = jest.requireActual('react-native');
  return { DocScanBody: (p: { teachOnly?: boolean }) => <Text testID="eski-belge-tara">{p.teachOnly ? 'tanit' : 'eski'}</Text> };
});

const route = (id: string, name: string, order: number) => ({ id, name, isWorkOrderShortcut: true, shortcutOrder: order, isActive: true });

beforeEach(() => {
  useDeviceSettingsStore.setState({ docDeskDevice: false });
  mockShortcuts.mockReset();
  mockEntry = { entry: 'BELGE', ready: true };
  mockScan = false;
});

describe('WoCreateScreen — S16b giriş kipi BELGE', () => {
  it('⭐ seçici: "<İE> oluştur" karosu var; Hızlı İE, belge masası, Belge Tara YOK', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-ozel-turler')).toBeTruthy());
    expect(s.getByTestId('ie-tur-form')).toBeTruthy();
    expect(s.queryByTestId('ie-tur-hizli')).toBeNull();
    expect(s.queryByTestId('ie-tur-belge-masasi')).toBeNull();
    expect(s.queryByTestId('ie-tur-belge-tara')).toBeNull();
  });

  it('⭐ "<İE> oluştur" → tek form, rota seçilir', async () => {
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('ie-tur-form'));
    expect(s.getByTestId('tek-form').props.children).toBe('yok:secilir');
    expect(s.queryByTestId('eski-belge-tara')).toBeNull();
  });

  it('⭐ özel iş emri karosu → AYNI tek form, rota ön seçili ve kilitli; Hızlı İE formu açılmaz', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('kisayol-Kurşun&Tambur'));
    expect(s.getByTestId('tek-form').props.children).toBe('r1:kilitli');
    expect(s.queryByTestId('hizli-form')).toBeNull();
    expect(s.queryByTestId('ie-birden-cok-belge')).toBeNull();
  });

  it('⭐ tek formda "Alanlar" başlıkta (gövdede değil): dokununca forma kontrollü açıklık gider; seçicide çip yok', async () => {
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    await s.findByTestId('kisayol-Kurşun&Tambur');
    expect(within(s.getByTestId('baslik-ekleri')).queryByTestId('ie-alanlar')).toBeNull();
    fireEvent.press(s.getByTestId('kisayol-Kurşun&Tambur'));
    expect(s.getByTestId('tek-form-alanlar').props.children).toBe('false');
    fireEvent.press(within(s.getByTestId('baslik-ekleri')).getByTestId('ie-alanlar'));
    expect(s.getByTestId('tek-form-alanlar').props.children).toBe('true');
  });

  it('rotasız karo (Okutmayla) da tek formu açar', async () => {
    mockScan = true;
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('ie-rotasiz'));
    expect(s.getByTestId('tek-form').props.children).toBe('scan-routed:kilitli');
  });

  it('⭐ "Bu cihaz belge masası" açık olsa da BELGE kipinde masa kendiliğinden açılmaz', async () => {
    useDeviceSettingsStore.setState({ docDeskDevice: true });
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-ozel-turler')).toBeTruthy());
    expect(s.queryByTestId('belge-masasi')).toBeNull();
  });

  it('kip okunana kadar karo çizilmez (top yolu sızmaz) ve masa açılmaz', async () => {
    mockEntry = { entry: 'IKISI', ready: false };
    useDeviceSettingsStore.setState({ docDeskDevice: true });
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(mockShortcuts).toHaveBeenCalled());
    expect(s.getByTestId('ie-giris-kipi-yukleniyor')).toBeTruthy();
    expect(s.queryByTestId('ie-tur-hizli')).toBeNull();
    expect(s.queryByTestId('belge-masasi')).toBeNull();
  });
});

describe('WoCreateScreen — S16b giriş kipi TOP', () => {
  it('⭐ yalnız top yolu: Hızlı İE var; tek form, masa, Belge Tara yok', async () => {
    mockEntry = { entry: 'TOP', ready: true };
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    expect(await s.findByTestId('ie-tur-hizli')).toBeTruthy();
    expect(s.queryByTestId('ie-tur-form')).toBeNull();
    expect(s.queryByTestId('ie-tur-belge-tara')).toBeNull();
  });

  it('özel karo → Hızlı İE formu, Belge okut çubuğu yok; rotasızda rota ön seçimi yok', async () => {
    mockEntry = { entry: 'TOP', ready: true };
    mockScan = true;
    mockShortcuts.mockResolvedValue({ data: [route('r1', 'Kurşun&Tambur', 1)] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('kisayol-Kurşun&Tambur'));
    expect(s.getByTestId('hizli-form').props.children).toBe('rota:r1');
    expect(s.queryByTestId('ie-belge-okut')).toBeNull();
  });

  it('TOP + rotasız karo → Hızlı İE (rotasız seçim formda), ipucu/belge çubuğu yok', async () => {
    mockEntry = { entry: 'TOP', ready: true };
    mockScan = true;
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('ie-rotasiz'));
    expect(s.getByTestId('hizli-form').props.children).toBe('rota:yok');
    expect(s.queryByTestId('ie-rotasiz-ipucu')).toBeNull();
    expect(s.queryByTestId('ie-belge-okut')).toBeNull();
  });
});

// K30-A: "Belge tanıt" karosu — şablon + okuma + yazma izni şart; TOP kipinde (belge yolu kapalı) yok.
describe('WoCreateScreen — K30-A Belge tanıt karosu', () => {
  const TEACH = ['gelen-belge:template', 'gelen-belge:read', 'gelen-belge:write'];
  const setPerms = (permissions: string[]) => act(() => useAuthStore.setState({ user: { permissions } as never }));
  afterEach(() => act(() => useAuthStore.setState({ user: null })));

  it('⭐ izinliyse BELGE kipinde görünür; dokununca tarama gövdesi YALNIZ tanıtma kipinde açılır', async () => {
    setPerms(TEACH);
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    fireEvent.press(await s.findByTestId('ie-tur-belge-tanit'));
    expect(s.getByTestId('baslik').props.children).toBe('Belge tanıt');
    expect(s.getByTestId('eski-belge-tara').props.children).toBe('tanit');
  });

  it('IKISI kipinde de izinliyse görünür', async () => {
    mockEntry = { entry: 'IKISI', ready: true };
    setPerms(TEACH);
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    expect(await s.findByTestId('ie-tur-belge-tanit')).toBeTruthy();
  });

  it.each([
    ['şablon izni yok', ['gelen-belge:read', 'gelen-belge:write']],
    ['yazma izni yok', ['gelen-belge:template', 'gelen-belge:read']],
    ['okuma izni yok', ['gelen-belge:template', 'gelen-belge:write']],
  ])('%s → karo yok', async (_n, perms) => {
    setPerms(perms);
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    await waitFor(() => expect(s.getByTestId('ie-tur-form')).toBeTruthy());
    expect(s.queryByTestId('ie-tur-belge-tanit')).toBeNull();
  });

  it('TOP kipinde izinli olsa da karo yok', async () => {
    mockEntry = { entry: 'TOP', ready: true };
    setPerms(TEACH);
    mockShortcuts.mockResolvedValue({ data: [] });
    const s = renderWithPaper(<WoCreateScreen />);
    expect(await s.findByTestId('ie-tur-hizli')).toBeTruthy();
    expect(s.queryByTestId('ie-tur-belge-tanit')).toBeNull();
  });
});
