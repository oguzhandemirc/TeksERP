// =============================================================================
// useAlphaKeyboardPref — harfli klavye seçimi YALNIZ o denemede geçerli, KALICI DEĞİL (1e kararı 2026-09-18)
// =============================================================================
//   §1 varsayılan false (her giriş denemesi sayısal başlar)
//   §2 toggle çevirir; taze hook yeniden false başlar (kalıcılık YOK — paylaşımlı vardiya tableti)
//   §3 AsyncStorage'a HİÇ dokunmaz (persist kaldırıldı)
// =============================================================================
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAlphaKeyboardPref } from './useAlphaKeyboardPref';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) },
}));

const mockStorage = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock };

beforeEach(() => {
  mockStorage.getItem.mockClear();
  mockStorage.setItem.mockClear();
});

describe('useAlphaKeyboardPref', () => {
  it('§1 varsayılan false — her giriş denemesi sayısal başlar', () => {
    const { result } = renderHook(() => useAlphaKeyboardPref());
    expect(result.current.alphaKeyboard).toBe(false);
  });

  it('§2 ⭐ toggle çevirir; taze hook yeniden false (kalıcılık YOK)', () => {
    const { result } = renderHook(() => useAlphaKeyboardPref());
    act(() => result.current.toggleAlphaKeyboard());
    expect(result.current.alphaKeyboard).toBe(true);
    act(() => result.current.toggleAlphaKeyboard());
    expect(result.current.alphaKeyboard).toBe(false);
    // Sonraki deneme (taze mount) tercihi HATIRLAMAZ.
    const { result: r2 } = renderHook(() => useAlphaKeyboardPref());
    expect(r2.current.alphaKeyboard).toBe(false);
  });

  it('§3 ⭐ AsyncStorage’a hiç dokunmaz — persist kaldırıldı', () => {
    const { result } = renderHook(() => useAlphaKeyboardPref());
    act(() => result.current.toggleAlphaKeyboard());
    expect(mockStorage.getItem).not.toHaveBeenCalled();
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });
});
