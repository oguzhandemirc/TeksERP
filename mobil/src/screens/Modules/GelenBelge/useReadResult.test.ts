// Okuma sonucu sorgu döngüsü: 2 sn aralık, sonuçta durur, ekran kapanınca (unmount) durur, runKey baştan başlatır.
import { act, renderHook } from '@testing-library/react-native';
import type { ReadSummary } from '../../../services/inboundDoc.service';
import { READ_POLL_INTERVAL_MS } from './readResult';
import { useReadResult } from './useReadResult';

jest.mock('../../../services/inboundDoc.service', () => ({ inboundDocService: { readSummary: jest.fn() } }));

const reading = { state: 'READING' } as ReadSummary;
const read = { state: 'READ', lineCount: 3 } as ReadSummary;
const flush = async () => {
  await act(async () => {});
};
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
};

describe('useReadResult', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('taslak yokken sormaz', async () => {
    const fetcher = jest.fn();
    const { result } = renderHook(() => useReadResult(null, 0, fetcher));
    await advance(10_000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.watch).toBeNull();
  });

  it('hemen sorar, 2 sn aralıkla tekrarlar, okununca DURUR', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(reading).mockResolvedValueOnce(reading).mockResolvedValue(read);
    const { result } = renderHook(() => useReadResult('n1', 1, fetcher));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.watch?.phase).toBe('polling');
    await advance(READ_POLL_INTERVAL_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(READ_POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.watch?.phase).toBe('done');
    await advance(READ_POLL_INTERVAL_MS * 5);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('ekrandan çıkınca (unmount) sorgu durur', async () => {
    const fetcher = jest.fn().mockResolvedValue(reading);
    const { unmount } = renderHook(() => useReadResult('n1', 1, fetcher));
    await flush();
    await advance(READ_POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
    await advance(READ_POLL_INTERVAL_MS * 10);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('kesin 4xx → hata ve durur; "Yeniden bak" baştan sorar', async () => {
    const fetcher = jest.fn().mockRejectedValueOnce(Object.assign(new Error('Yetkiniz yok'), { status: 403 })).mockResolvedValue(read);
    const { result } = renderHook(() => useReadResult('n1', 1, fetcher));
    await flush();
    expect(result.current.watch).toMatchObject({ phase: 'error', message: 'Yetkiniz yok' });
    await advance(READ_POLL_INTERVAL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => result.current.recheck());
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.watch?.phase).toBe('done');
  });

  it('runKey değişince (aynı taslağa yeni sayfa) izleme baştan başlar', async () => {
    const fetcher = jest.fn().mockResolvedValue(read);
    const { rerender, result } = renderHook(({ k }: { k: number }) => useReadResult('n1', k, fetcher), { initialProps: { k: 1 } });
    await flush();
    expect(result.current.watch?.phase).toBe('done');
    fetcher.mockResolvedValue(reading);
    rerender({ k: 2 });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.watch?.phase).toBe('polling');
  });
});
