// Bekçi: useLabelCopies — GLOBAL'de seçici kapalı ve istek adet taşımaz; STATION'da
// istasyon varsayılanıyla dolar, take() adedi verip seçiciyi varsayılana döndürür.
import { act, renderHook } from '@testing-library/react-native';
import { useLabelCopies } from './useLabelCopies';
import { useSessionStore } from '../store/sessionStore';
import { useLabelCopiesStore } from '../store/labelCopiesStore';

let mockFlags: { labelCopiesSource?: string; labelCopies?: number } | undefined;
jest.mock('./useFeatureFlags', () => ({
  useFeatureFlags: () => ({ data: mockFlags }),
}));

function setStation(id: string, defaultLabelCopies: number | null) {
  useSessionStore.setState({
    active: { station: { id, code: id, name: id, kind: 'KK1', defaultLabelCopies } } as never,
  });
}

beforeEach(() => {
  useLabelCopiesStore.getState().reset();
  setStation('s1', 3);
});

describe('useLabelCopies', () => {
  it('GLOBAL: kapalı, take() undefined (istek bugünkü gibi adetsiz)', () => {
    mockFlags = { labelCopiesSource: 'GLOBAL', labelCopies: 2 };
    const { result } = renderHook(() => useLabelCopies());
    expect(result.current.enabled).toBe(false);
    expect(result.current.take()).toBeUndefined();
  });

  it('bayrak okunamadı: kapalı (fail-closed)', () => {
    mockFlags = undefined;
    const { result } = renderHook(() => useLabelCopies());
    expect(result.current.enabled).toBe(false);
  });

  it('STATION: istasyon varsayılanı, artır, take() verir ve varsayılana döner', () => {
    mockFlags = { labelCopiesSource: 'STATION', labelCopies: 1 };
    const { result } = renderHook(() => useLabelCopies());
    expect(result.current.enabled).toBe(true);
    expect(result.current.count).toBe(3);
    act(() => result.current.inc());
    expect(result.current.count).toBe(4);
    let taken: number | undefined;
    act(() => {
      taken = result.current.take();
    });
    expect(taken).toBe(4);
    expect(result.current.count).toBe(3);
  });

  it('STATION: istasyon varsayılanı boş → genel adet; tavan 5', () => {
    mockFlags = { labelCopiesSource: 'STATION', labelCopies: 4 };
    setStation('s2', null);
    const { result } = renderHook(() => useLabelCopies());
    expect(result.current.count).toBe(4);
    act(() => result.current.inc());
    act(() => result.current.inc());
    expect(result.current.count).toBe(5);
  });

  it('istasyon değişince eski seçim uygulanmaz', () => {
    mockFlags = { labelCopiesSource: 'STATION', labelCopies: 1 };
    const { result } = renderHook(() => useLabelCopies());
    act(() => result.current.dec());
    expect(result.current.count).toBe(2);
    act(() => setStation('s9', 5));
    expect(result.current.count).toBe(5);
  });
});
