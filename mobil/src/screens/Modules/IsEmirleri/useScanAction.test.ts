// Belge Okut tuşundaki rota cihazda kalıcı (operatöre bağlı): yeniden girişte son seçim gelir; listede olmayan kayıt
// varsayılana düşer. Ayar kapalıyken saklı rota okunmaz, silinir ve oluşturma yüküne girmez.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useScanAction, WO_SCAN_ROUTE_KEY } from './useScanAction';
import { SCAN_ROUTE_ID } from '../GelenBelge/woCreate/woFromDoc';
import { buttonRouteFor, encodeStoredRoute, initialFormRoute } from './createEntry';

const mockStore = new Map<string, string>();
jest.mock('../../../utils/storage', () => ({
  storage: {
    getItem: (k: string) => Promise.resolve(mockStore.get(k) ?? null),
    setItem: (k: string, v: string) => { mockStore.set(k, v); return Promise.resolve(); },
    deleteItem: (k: string) => { mockStore.delete(k); return Promise.resolve(); },
  },
}));
jest.mock('../../../store/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { userId: 'u-1' } }) }));
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
    const a = renderHook(() => useScanAction(true));
    expect(a.result.current.type?.id).toBe(SCAN_ROUTE_ID);
    act(() => a.result.current.select('r-boya'));
    expect(mockStore.get(WO_SCAN_ROUTE_KEY)).toBe(encodeStoredRoute('u-1', 'r-boya'));
    a.unmount();
    const b = renderHook(() => useScanAction(true));
    await waitFor(() => expect(b.result.current.type?.id).toBe('r-boya'));
  });

  it('kayıtlı rota artık yoksa varsayılana düşer', async () => {
    mockStore.set(WO_SCAN_ROUTE_KEY, encodeStoredRoute('u-1', 'r-silindi'));
    const h = renderHook(() => useScanAction(true));
    await waitFor(() => expect(h.result.current.type?.id).toBe(SCAN_ROUTE_ID));
  });

  it('ayar kapalıyken saklı rota okunmaz, silinir ve oluşturma yüküne girmez (kart rotası ya da rotasız gider)', async () => {
    mockStore.set(WO_SCAN_ROUTE_KEY, encodeStoredRoute('u-1', 'r-boya'));
    const h = renderHook(() => useScanAction(false));
    await waitFor(() => expect(mockStore.has(WO_SCAN_ROUTE_KEY)).toBe(false));
    expect(h.result.current.type?.id).toBe(SCAN_ROUTE_ID);
    // Tuş kendisi bir rota seçmiş olsa bile ayar kapalıyken forma (ve yüke) geçmez.
    const picked = routes[1];
    const route = initialFormRoute({ buttonRoute: buttonRouteFor(false, picked), cardRoute: null, scanMode: true });
    // useWoRows: rotasız = routeTemplateId null.
    expect(route?.id).toBe(SCAN_ROUTE_ID);
    const card = routes[0];
    expect(initialFormRoute({ buttonRoute: buttonRouteFor(false, picked), cardRoute: card, scanMode: true })?.id).toBe('r-apre');
    expect(initialFormRoute({ buttonRoute: buttonRouteFor(true, picked), cardRoute: card, scanMode: true })?.id).toBe('r-boya');
  });
});
