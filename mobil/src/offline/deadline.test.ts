import { withDeadline } from './deadline';

describe('withDeadline', () => {
  it('iş tavandan önce biterse değeri döner', async () => {
    await expect(withDeadline(Promise.resolve(42), 1_000)).resolves.toEqual({
      timedOut: false,
      value: 42,
    });
  });

  it('hata "bitti" sayılır — ASLA reject etmez', async () => {
    await expect(withDeadline(Promise.reject(new Error('x')), 1_000)).resolves.toEqual({
      timedOut: false,
    });
  });

  it('tavan dolunca timedOut döner; iş iptal EDİLMEZ, geç hata unhandled olmaz', async () => {
    jest.useFakeTimers();
    try {
      let rejectLate!: (e: Error) => void;
      const p = withDeadline(
        new Promise<never>((_, reject) => {
          rejectLate = reject;
        }),
        500,
      );
      await jest.advanceTimersByTimeAsync(501);
      await expect(p).resolves.toEqual({ timedOut: true });
      // Tavandan SONRA gelen rejection — withDeadline handler bağladığı için
      // unhandled-rejection üretmemeli (üretirse jest bu testi düşürür).
      rejectLate(new Error('geç hata'));
      await Promise.resolve();
    } finally {
      jest.useRealTimers();
    }
  });

  it('timer temizlenir (tavandan önce biten işte sızıntı yok)', async () => {
    jest.useFakeTimers();
    try {
      await withDeadline(Promise.resolve('ok'), 60_000);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
