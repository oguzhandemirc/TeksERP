// Bekçi: denetim Y4 — barındırılan kurulumda vekil 5xx'i ve 429 istasyon kaydını DÜŞÜRMEZ;
// backend'in kendi JSON 500'ü bugünkü gibi 3 denemede biter; kuyruk boşaltması sınırlı
// eşzamanlılıkla (≤ STATION_CONCURRENCY) akar. Retry/limiter GERÇEK kayıtlı config'tir.

import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { kursunQcService } from '../services/kursunQc.service';
import { registerStationMutationDefaults, STATION_MUT } from './mutations';
import { queryClient } from './queryClient';
import { STATION_CONCURRENCY } from './stationLimiter';
import { classifyHttpFailure, parseRetryAfterMs } from './transientHttp';
// jest.mock çağrıları babel-jest ile içe aktarımların üstüne taşınır.
jest.mock('../services/kursunQc.service', () => ({
  kursunQcService: { completeQc2: jest.fn(), reportError: jest.fn(), deleteError: jest.fn(), finishStep: jest.fn() },
}));
jest.mock('../services/roll.service', () => ({
  rollService: { kursunFinish: jest.fn(), createInitialEntry: jest.fn(), scrap: jest.fn() },
}));
jest.mock('../services/tambur.service', () => ({ tamburService: { finalizeOpenFabric: jest.fn() } }));
jest.mock('../services/subcontractor.service', () => ({
  subcontractorService: { dispatch: jest.fn(), receive: jest.fn() },
}));
jest.mock('../services/kartela.service', () => ({ kartelaService: { dispatch: jest.fn(), receive: jest.fn() } }));
jest.mock('../services/api', () => ({ resolveAuthToken: jest.fn(async () => 'test-token') }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));


type RetryFn = (failureCount: number, error: unknown) => boolean;
type DelayFn = (attempt: number, error: unknown) => number;
const defaults = () => queryClient.getMutationDefaults(STATION_MUT.QC2_COMPLETE as unknown as unknown[]);
const retry = () => defaults().retry as RetryFn;
const delay = () => defaults().retryDelay as DelayFn;

const err = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { status, ...extra });

beforeAll(() => registerStationMutationDefaults());
afterEach(() => {
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

describe('classifyHttpFailure — vekil mi backend mi', () => {
  it('502/503/504/52x HTML gövde → gateway', () => {
    for (const s of [502, 503, 504, 520, 521, 522, 524, 530]) {
      expect(classifyHttpFailure(s, '<html>Bad Gateway</html>')).toBe('gateway');
    }
  });
  it('zarfsız her 5xx → gateway; zarflı 500 → null (bugünkü davranış); zarflı 503 → busy', () => {
    expect(classifyHttpFailure(500, '')).toBe('gateway');
    expect(classifyHttpFailure(500, { success: false, message: 'x' })).toBeNull();
    expect(classifyHttpFailure(503, { success: false, message: 'meşgul' })).toBe('busy');
  });
  it('429 → rate-limit; 4xx ve 2xx → null', () => {
    expect(classifyHttpFailure(429, { success: false })).toBe('rate-limit');
    expect(classifyHttpFailure(409, { success: false })).toBeNull();
    expect(classifyHttpFailure(undefined, undefined)).toBeNull();
  });
  it('Retry-After: saniye, HTTP-tarihi, details.retryAfterSec; tavanlı', () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    expect(parseRetryAfterMs('7', undefined, now)).toBe(7000);
    expect(parseRetryAfterMs('Sun, 01 Nov 2026 10:00:30 GMT', undefined, now)).toBe(30_000);
    expect(parseRetryAfterMs(undefined, { retryAfterSec: 12 }, now)).toBe(12_000);
    expect(parseRetryAfterMs(undefined, undefined, now)).toBeNull();
    expect(parseRetryAfterMs('99999', undefined, now)).toBe(10 * 60_000);
  });
});

describe('istasyon retry — geçici hata kaydı düşürmez', () => {
  it('⭐ vekil 5xx (gateway) ve 429 süresiz denenir', () => {
    for (const transient of ['gateway', 'rate-limit', 'busy']) {
      expect(retry()(50, err(502, { transient }))).toBe(true);
    }
  });
  it('backend JSON 500 bugünkü gibi 3 denemede durur; 409 fail-fast', () => {
    expect(retry()(2, err(500))).toBe(true);
    expect(retry()(3, err(500))).toBe(false);
    expect(retry()(0, err(409))).toBe(false);
  });
  it('429 Retry-After\'dan ÖNCE denenmez (+%30 jitter tavanı)', () => {
    for (let i = 0; i < 20; i++) {
      const d = delay()(0, err(429, { transient: 'rate-limit', retryAfterMs: 20_000 }));
      expect(d).toBeGreaterThanOrEqual(20_000);
      expect(d).toBeLessThanOrEqual(26_000);
    }
  });
  it('Retry-After yoksa üstel bekleme (2 sn taban, ≤ 78 sn)', () => {
    const d0 = delay()(0, err(429, { transient: 'rate-limit' }));
    expect(d0).toBeGreaterThanOrEqual(1400);
    expect(delay()(10, err(429, { transient: 'rate-limit' }))).toBeLessThanOrEqual(78_000);
  });
});

describe('kuyruk entegrasyonu — kayıt kuyrukta kalır', () => {
  beforeAll(() => queryClient.mount());
  afterAll(() => {
    queryClient.getMutationCache().clear();
    queryClient.unmount();
  });

  async function runWithFailures(failures: Error[], advanceMs: number) {
    jest.useFakeTimers();
    let calls = 0;
    const fn = jest.fn(async () => {
      const f = failures[calls++];
      if (f) throw f;
      return { ok: true };
    });
    const obs = new MutationObserver(queryClient, {
      mutationKey: STATION_MUT.QC2_COMPLETE as unknown as unknown[],
      mutationFn: fn,
      networkMode: defaults().networkMode,
      retry: defaults().retry,
      retryDelay: defaults().retryDelay,
    });
    const unsub = obs.subscribe(() => {});
    const p = obs.mutate({ rollId: 'r1' } as never).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(advanceMs);
    const res = obs.getCurrentResult();
    unsub();
    return { fn, res, p };
  }

  it('⭐ 502 HTML ×5 sonra 200: kayıt düşmez, gider', async () => {
    const gw = () => err(502, { transient: 'gateway' });
    const { fn, res } = await runWithFailures([gw(), gw(), gw(), gw(), gw()], 10 * 60_000);
    expect(res.isError).toBe(false);
    expect(res.isSuccess).toBe(true);
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('⭐ 503 HTML ×4 sonra 200: kayıt düşmez', async () => {
    const gw = () => err(503, { transient: 'gateway' });
    const { fn, res } = await runWithFailures([gw(), gw(), gw(), gw()], 10 * 60_000);
    expect(res.isSuccess).toBe(true);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('⭐ 429 Retry-After=30 sn: süre dolmadan ikinci deneme yok, sonra gider', async () => {
    jest.useFakeTimers();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(err(429, { transient: 'rate-limit', retryAfterMs: 30_000 }))
      .mockResolvedValue({ ok: true });
    const obs = new MutationObserver(queryClient, {
      mutationKey: STATION_MUT.QC2_COMPLETE as unknown as unknown[],
      mutationFn: fn,
      networkMode: defaults().networkMode,
      retry: defaults().retry,
      retryDelay: defaults().retryDelay,
    });
    const unsub = obs.subscribe(() => {});
    void obs.mutate({ rollId: 'r2' } as never).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(29_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(obs.getCurrentResult().isError).toBe(false);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(obs.getCurrentResult().isSuccess).toBe(true);
    unsub();
  });

  it('⭐ 429 Retry-After\'sız ×4 sonra 200: kayıt düşmez', async () => {
    const rl = () => err(429, { transient: 'rate-limit' });
    const { res } = await runWithFailures([rl(), rl(), rl(), rl()], 10 * 60_000);
    expect(res.isSuccess).toBe(true);
  });

  it('JSON 500 (backend kendi hatası) eski davranış: 4 denemede kalıcı düşer', async () => {
    const e = () => err(500);
    const { fn, res } = await runWithFailures([e(), e(), e(), e(), e()], 10 * 60_000);
    expect(res.isError).toBe(true);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe('kuyruk boşaltma — sınırlı eşzamanlılık', () => {
  it(`⭐ kayıtlı mutationFn aynı anda en çok ${STATION_CONCURRENCY} istek sürer, sıra FIFO`, async () => {
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const resolvers: (() => void)[] = [];
    (kursunQcService.completeQc2 as jest.Mock).mockImplementation(async (v: { rollId: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(v.rollId);
      await new Promise<void>((r) => resolvers.push(r));
      active -= 1;
      return { ok: true };
    });
    const fn = defaults().mutationFn as (v: unknown) => Promise<unknown>;
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => fn({ rollId: `r${i}` })));
    for (let k = 0; k < 20; k++) {
      await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      resolvers.splice(0).forEach((r) => r());
    }
    await all;
    expect(peak).toBeLessThanOrEqual(STATION_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(order).toEqual(Array.from({ length: 10 }, (_, i) => `r${i}`));
  });
});
