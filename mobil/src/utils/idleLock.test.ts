import {
  computeIdlePhase,
  warningSeconds,
  idleMinutesToMs,
  IDLE_WARNING_MS,
} from './idleLock';

const IDLE = 10 * 60_000; // 10 dk
const WARN = 20_000; // 20 sn

describe('computeIdlePhase', () => {
  const t0 = 1_000_000;

  it('yeni aktivite → active (tam süre kalır)', () => {
    const s = computeIdlePhase(t0, t0, IDLE, WARN);
    expect(s.phase).toBe('active');
    expect(s.msUntilLock).toBe(IDLE);
  });

  it('eşiğin hemen altı → active', () => {
    const now = t0 + (IDLE - WARN - 1);
    expect(computeIdlePhase(t0, now, IDLE, WARN).phase).toBe('active');
  });

  it('uyarı penceresine girince → warning + doğru kalan süre', () => {
    const now = t0 + (IDLE - WARN); // tam uyarı sınırı
    const s = computeIdlePhase(t0, now, IDLE, WARN);
    expect(s.phase).toBe('warning');
    expect(s.msUntilLock).toBe(WARN);
  });

  it('uyarı ortası → warning, kalan süre azalır', () => {
    const now = t0 + (IDLE - 5_000);
    const s = computeIdlePhase(t0, now, IDLE, WARN);
    expect(s.phase).toBe('warning');
    expect(s.msUntilLock).toBe(5_000);
  });

  it('süre dolunca → locked (msUntilLock 0)', () => {
    const s = computeIdlePhase(t0, t0 + IDLE, IDLE, WARN);
    expect(s.phase).toBe('locked');
    expect(s.msUntilLock).toBe(0);
  });

  it('süre aşımı → locked (negatif değil, 0)', () => {
    const s = computeIdlePhase(t0, t0 + IDLE + 999_999, IDLE, WARN);
    expect(s.phase).toBe('locked');
    expect(s.msUntilLock).toBe(0);
  });

  it('saat geri giderse (now < lastActivity) → active (kilitlenmez)', () => {
    const s = computeIdlePhase(t0, t0 - 5_000, IDLE, WARN);
    expect(s.phase).toBe('active');
    expect(s.msUntilLock).toBe(IDLE);
  });

  it('geçiş sırası monotonik: active → warning → locked', () => {
    const phases = [0, IDLE - WARN - 1, IDLE - WARN, IDLE - 1, IDLE].map(
      (d) => computeIdlePhase(t0, t0 + d, IDLE, WARN).phase,
    );
    expect(phases).toEqual(['active', 'active', 'warning', 'warning', 'locked']);
  });
});

describe('warningSeconds', () => {
  it('yukarı yuvarlar', () => {
    expect(warningSeconds(19_100)).toBe(20);
    expect(warningSeconds(1)).toBe(1);
    expect(warningSeconds(1000)).toBe(1);
    expect(warningSeconds(1001)).toBe(2);
  });
  it('0/negatif → 0', () => {
    expect(warningSeconds(0)).toBe(0);
    expect(warningSeconds(-500)).toBe(0);
  });
});

describe('idleMinutesToMs', () => {
  it('geçerli dakika → ms', () => {
    expect(idleMinutesToMs(10)).toBe(600_000);
    expect(idleMinutesToMs(1)).toBe(60_000);
  });
  it('clamp 1..120', () => {
    expect(idleMinutesToMs(0)).toBe(10 * 60_000); // 0 geçersiz → fallback
    expect(idleMinutesToMs(999)).toBe(120 * 60_000);
    expect(idleMinutesToMs(-5)).toBe(10 * 60_000);
  });
  it('geçersiz/undefined → fallback (default 10)', () => {
    expect(idleMinutesToMs(undefined)).toBe(600_000);
    expect(idleMinutesToMs(NaN)).toBe(600_000);
    expect(idleMinutesToMs(undefined, 5)).toBe(300_000);
  });
});

describe('IDLE_WARNING_MS', () => {
  it('20 saniye', () => {
    expect(IDLE_WARNING_MS).toBe(20_000);
  });
});
