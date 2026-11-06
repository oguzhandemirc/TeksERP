// "İş Emri Rotası" seçimi cihazda kalıcı: yeniden girişte son seçim gelir; listede olmayan kayıt varsayılana düşer.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useScanAction, WO_SCAN_ROUTE_KEY } from './useScanAction';
import { SCAN_ROUTE_ID } from '../GelenBelge/woCreate/woFromDoc';

const mockStore = new Map<string, string>();
jest.mock('../../../utils/storage', () => ({
  storage: {
    getItem: (k: string) => Promise.resolve(mockStore.get(k) ?? null),
    setItem: (k: string, v: string) => { mockStore.set(k, v); return Promise.resolve(); },
  },
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useScanRouteMode: () => true }));
jest.mock('../../../hooks/useVisibleScreens', () => ({ useVisibleScreens: () => ({ visibleScreens: [{ key: 'GelenBelge' }] }) }));
jest.mock('../GelenBelge/woCreate/useWoEntry', () => ({ useTabletWoEntry: () => ({ entry: 'BELGE', ready: true }) }));
jest.mock('../GelenBelge/woCreate/WoCreateScreen', () => ({ WO_SHORTCUTS_KEY: ['wo-shortcuts'] }));
const routes = [{ id: 'r-apre', name: 'Apre', steps: [], isActive: true }, { id: 'r-boya', name: 'Boya', steps: [], isActive: true }];
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => ({ data: { data: queryKey[0] === 'routes' ? routes : [] }, isLoading: false }),
}));

beforeEach(() => mockStore.clear());

describe('useScanAction — rota seçimi kalıcılığı', () => {
  it('seçim diske yazılır ve yeni girişte geri gelir', async () => {
    const a = renderHook(() => useScanAction());
    expect(a.result.current.type?.id).toBe(SCAN_ROUTE_ID);
    act(() => a.result.current.select('r-boya'));
    expect(mockStore.get(WO_SCAN_ROUTE_KEY)).toBe('r-boya');
    a.unmount();
    const b = renderHook(() => useScanAction());
    await waitFor(() => expect(b.result.current.type?.id).toBe('r-boya'));
  });

  it('kayıtlı rota artık yoksa varsayılana düşer', async () => {
    mockStore.set(WO_SCAN_ROUTE_KEY, 'r-silindi');
    const h = renderHook(() => useScanAction());
    await waitFor(() => expect(h.result.current.type?.id).toBe(SCAN_ROUTE_ID));
  });
});
