import { act, renderHook } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';
import { useManualRefresh } from './useManualRefresh';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

describe('useManualRefresh başarı toast\'ı', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Toast.show as jest.Mock).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('çekince varsayılan metinle toast gösterir', async () => {
    const refetch = jest.fn().mockResolvedValue({ status: 'success' });
    const { result } = renderHook(() => useManualRefresh(refetch));
    await act(async () => {
      result.current.onRefresh();
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Liste güncellendi' });
  });

  it('sayfa metni verirse onu gösterir', async () => {
    const { result } = renderHook(() => useManualRefresh(() => Promise.resolve({}), 'Depo güncellendi'));
    await act(async () => {
      result.current.onRefresh();
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Depo güncellendi' });
  });

  it('hata olunca başarı toast\'ı çıkmaz', async () => {
    const { result } = renderHook(() => useManualRefresh(() => Promise.resolve({ isError: true, error: new Error('x') })));
    await act(async () => {
      result.current.onRefresh();
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(Toast.show).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(true);
  });

  it('otomatik yenileme (hook çağrılmadan) toast çıkarmaz', async () => {
    const refetch = jest.fn().mockResolvedValue({});
    renderHook(() => useManualRefresh(refetch));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(refetch).not.toHaveBeenCalled();
    expect(Toast.show).not.toHaveBeenCalled();
  });
});
