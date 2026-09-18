// =============================================================================
// useAlphaKeyboardPref — "harfli klavye" tercihi cihazda hatırlanır (K bulgusu 2026-09-18)
// =============================================================================
//   §1 varsayılan false; AsyncStorage'da '1' varsa açılışta true
//   §2 toggle çevirir ve AsyncStorage'a yazar ('1'/'0')
// Negatif sonda (2026-09-18, bir kezlik): toggle setItem çağırmadı → §2 (setItem) ❌.
// =============================================================================
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAlphaKeyboardPref, ALPHA_KEYBOARD_KEY } from './useAlphaKeyboardPref';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) },
}));

const mockStorage = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock };

beforeEach(() => {
  mockStorage.getItem.mockReset().mockResolvedValue(null);
  mockStorage.setItem.mockReset().mockResolvedValue(undefined);
});

describe('useAlphaKeyboardPref', () => {
  it('§1 varsayılan false; kayıtlı "1" → true', async () => {
    const { result } = renderHook(() => useAlphaKeyboardPref());
    expect(result.current.alphaKeyboard).toBe(false);

    mockStorage.getItem.mockResolvedValue('1');
    const { result: r2 } = renderHook(() => useAlphaKeyboardPref());
    await waitFor(() => expect(r2.current.alphaKeyboard).toBe(true));
  });

  it('§2 ⭐ toggle çevirir ve AsyncStorage\'a yazar', async () => {
    const { result } = renderHook(() => useAlphaKeyboardPref());
    await waitFor(() => expect(mockStorage.getItem).toHaveBeenCalledWith(ALPHA_KEYBOARD_KEY));
    act(() => result.current.toggleAlphaKeyboard());
    expect(result.current.alphaKeyboard).toBe(true);
    expect(mockStorage.setItem).toHaveBeenCalledWith(ALPHA_KEYBOARD_KEY, '1');
    act(() => result.current.toggleAlphaKeyboard());
    expect(result.current.alphaKeyboard).toBe(false);
    expect(mockStorage.setItem).toHaveBeenLastCalledWith(ALPHA_KEYBOARD_KEY, '0');
  });
});
