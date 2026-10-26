// Bekçi: tablet zil istemcisi merdiveni ve AppState geçişleri (plan §3.10, §6.8).
import { createBellClient } from './bellTransport';
import { BELL_ERROR_THRESHOLD, bellHealthy, type BellDeps, type StreamResponse } from './bellClient';
import type { NotificationSummary } from './types';

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

function sum(p: Partial<NotificationSummary> = {}): NotificationSummary {
  return { enabled: true, okunmamis: 0, alarmAcik: 0, epoch: 1, rev: 0, alarmRev: 0, ...p };
}

/** Elle beslenen SSE gövdesi. */
function stream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c; } });
  const enc = new TextEncoder();
  return {
    res: { status: 200, ok: true, body } as StreamResponse,
    send: (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
  };
}

function deps(over: Partial<BellDeps> = {}): BellDeps & { signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  return {
    signals,
    summary: jest.fn(async () => sum()),
    wait: jest.fn(() => new Promise<never>(() => {})),
    openStream: jest.fn(async (s: AbortSignal) => {
      signals.push(s);
      return stream().res;
    }),
    httpStatus: (e) => (e as { status?: number })?.status ?? null,
    sseEnabled: true,
    ...over,
  };
}

beforeEach(() => jest.useRealTimers());

it('arka planda bağlantı kapalı: setActive(false) akışı iptal eder, kip off', async () => {
  const d = deps();
  const c = createBellClient(d);
  await c.setActive(true);
  await flush();
  expect(c.state().mode).toBe('sse');
  expect(d.signals[0]?.aborted).toBe(false);
  await c.setActive(false);
  expect(d.signals[0]?.aborted).toBe(true);
  expect(c.state().mode).toBe('off');
});

it('öne dönüşte rev farkı → "changed" (kaçanlar tamamlanır), epoch farkı → "full"', async () => {
  const summary = jest.fn(async () => sum({ rev: 1 }));
  const c = createBellClient(deps({ summary }));
  const events: string[] = [];
  c.onEvent((e) => events.push(e));
  await c.setActive(true);
  await c.setActive(false);
  summary.mockResolvedValueOnce(sum({ rev: 4 }));
  await c.setActive(true);
  expect(events).toEqual(['changed']);
  await c.setActive(false);
  summary.mockResolvedValueOnce(sum({ epoch: 2, rev: 0 }));
  await c.setActive(true);
  expect(events).toEqual(['changed', 'full']);
});

it('SSE 404 → uzun yoklama; /bekle 404 → özet yoklaması', async () => {
  const d = deps({
    openStream: jest.fn(async () => ({ status: 404, ok: false, body: null })),
    wait: jest.fn(async () => Promise.reject({ status: 404 })),
  });
  const c = createBellClient(d);
  await c.setActive(true);
  await flush(10);
  expect(d.wait).toHaveBeenCalled();
  expect(c.state().mode).toBe('summary');
});

it(`merhabasız ${BELL_ERROR_THRESHOLD} kopuş → uzun yoklama (sağlıklı sayılır)`, async () => {
  jest.useFakeTimers();
  const d = deps({ openStream: jest.fn(async () => Promise.reject(new Error('ağ'))) });
  const c = createBellClient(d);
  await c.setActive(true);
  for (let i = 0; i < 5; i++) {
    await jest.advanceTimersByTimeAsync(11_000);
  }
  expect(d.openStream).toHaveBeenCalledTimes(BELL_ERROR_THRESHOLD);
  expect(c.state().mode).toBe('wait');
  expect(bellHealthy(c.state())).toBe(true);
  await c.setActive(false);
});

it('zil olayı özet okur ve "changed" yayar; merhaba bağlı yapar', async () => {
  const s = stream();
  const summary = jest.fn(async () => sum());
  const c = createBellClient(deps({ summary, openStream: jest.fn(async () => s.res) }));
  const events: string[] = [];
  c.onEvent((e) => events.push(e));
  await c.setActive(true);
  s.send('merhaba', { epoch: 1, rev: 0, alarmRev: 0 });
  await flush(10);
  expect(c.state().connected).toBe(true);
  summary.mockResolvedValueOnce(sum({ rev: 1, okunmamis: 2 }));
  s.send('zil', { k: 'kutu', rev: 1, alarmRev: 0 });
  await flush(10);
  expect(events).toContain('changed');
  expect(c.state().unread).toBe(2);
  s.send('zil', { k: 'alarm', rev: 1, alarmRev: 1 });
  await flush(10);
  expect(events).toContain('alarm');
  await c.setActive(false);
});

it('bayrak kapalı (ozet.enabled=false) → akış açılmaz; SSE kapalıysa doğrudan uzun yoklama', async () => {
  const off = deps({ summary: jest.fn(async () => sum({ enabled: false })) });
  const c1 = createBellClient(off);
  await c1.setActive(true);
  expect(off.openStream).not.toHaveBeenCalled();
  expect(c1.state().mode).toBe('off');
  const noSse = deps({ sseEnabled: false });
  const c2 = createBellClient(noSse);
  await c2.setActive(true);
  expect(noSse.openStream).not.toHaveBeenCalled();
  expect(c2.state().mode).toBe('wait');
  await c2.setActive(false);
});
