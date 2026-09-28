// =============================================================================
// BEKÇİ — Bölüm Seçimi başlığı bağlanılan sunucunun firma adıdır (koda gömülü müşteri adı yok)
// =============================================================================
//   §1 bayraktaki `companyName` başlıkta görünür (boş liste ve dolu liste dalı)
//   §2 bayrak yoksa ya da ad boşsa nötr "TeksERP"
// =============================================================================
import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ModuleSelectScreen from './ModuleSelectScreen';
import { FLAGS_KEY } from '../../hooks/useFeatureFlags';

let mockScreens: { key: string; title: string }[] = [];

jest.mock('../../components/ScreenChrome', () => ({
  __esModule: true,
  default: ({ title, children }: { title: string; children: ReactNode }) => {
    const { Text: T, View } = jest.requireActual('react-native');
    return (
      <View>
        <T testID="chrome-title">{title}</T>
        {children}
      </View>
    );
  },
}));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('../../components/SyncStatusChip', () => ({ __esModule: true, default: () => null }));
jest.mock('../../hooks/useDeviceType', () => ({ useDeviceType: () => 'tablet' }));
jest.mock('../../hooks/useModuleOrder', () => ({
  useModuleOrder: () => ({ orderedScreens: mockScreens, setModuleOrder: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Medium: 'medium' } }));
jest.mock('react-native-sortables', () => ({
  __esModule: true,
  default: { Grid: () => null, Touchable: ({ children }: { children: ReactNode }) => children },
}));

function cizdir(flags: Record<string, unknown> | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (flags) qc.setQueryData(FLAGS_KEY, flags);
  const u = render(
    <QueryClientProvider client={qc}>
      <ModuleSelectScreen />
    </QueryClientProvider>,
  );
  return u.getByTestId('chrome-title').props.children as string;
}

describe('ModuleSelectScreen — başlık sunucunun firma adı', () => {
  it('§1 boş listede başlık = bayraktaki companyName', () => {
    mockScreens = [];
    expect(cizdir({ companyName: 'TEST SUNUCUSU · ThinkPad' })).toBe('TEST SUNUCUSU · ThinkPad');
  });

  it('§1 dolu listede başlık = bayraktaki companyName', () => {
    mockScreens = [{ key: 'KK1', title: 'KK1' }];
    expect(cizdir({ companyName: 'Örnek Tekstil A.Ş.' })).toBe('Örnek Tekstil A.Ş.');
  });

  it('§2 bayrak yoksa nötr yedek (müşteri adı değil)', () => {
    mockScreens = [];
    expect(cizdir(undefined)).toBe('TeksERP');
  });

  it('§2 ad boşsa nötr yedek', () => {
    mockScreens = [];
    expect(cizdir({ companyName: '  ' })).toBe('TeksERP');
  });
});
