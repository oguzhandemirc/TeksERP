import { flushThenLogout, flushThenSwitch } from './flushThenLogout';
import type { JwtPayload } from '../types/auth';

// Her çağrıyı ortak bir `calls[]` diline yazan mock fabrikası → SIRA doğrulanır.
function makeDeps(online: boolean) {
  const calls: string[] = [];
  return {
    calls,
    isOnline: () => online,
    resumePausedMutations: jest.fn(async () => {
      calls.push('flush');
    }),
    clearQueryCache: jest.fn(() => {
      calls.push('clear');
    }),
    closeSession: jest.fn(async () => {
      calls.push('closeSession');
    }),
    resetSession: jest.fn(() => {
      calls.push('resetSession');
    }),
    clearAuth: jest.fn(async () => {
      calls.push('clearAuth');
    }),
    setAuth: jest.fn(async () => {
      calls.push('setAuth');
    }),
    initSession: jest.fn(async () => {
      calls.push('initSession');
    }),
  };
}

const userB: JwtPayload = { userId: 'b', username: 'operatorB', permissions: [] };

describe('flushThenLogout', () => {
  it('ONLINE: flush ÖNCE clearAuth, clear() flush SONRASI', async () => {
    const d = makeDeps(true);
    await flushThenLogout(d);
    expect(d.calls).toEqual(['flush', 'closeSession', 'resetSession', 'clearAuth', 'clear']);
    // Kritik invariant'lar:
    expect(d.calls.indexOf('flush')).toBeLessThan(d.calls.indexOf('clearAuth'));
    expect(d.calls.indexOf('clear')).toBeGreaterThan(d.calls.indexOf('flush'));
  });

  it('OFFLINE: flush ÇAĞRILMAZ (kuyruk beklemede kalır), diğer sıra korunur', async () => {
    const d = makeDeps(false);
    await flushThenLogout(d);
    expect(d.resumePausedMutations).not.toHaveBeenCalled();
    expect(d.calls).toEqual(['closeSession', 'resetSession', 'clearAuth', 'clear']);
  });

  it('flush hatası çıkışı bloklamaz (best-effort)', async () => {
    const d = makeDeps(true);
    d.resumePausedMutations.mockRejectedValueOnce(new Error('net'));
    await expect(flushThenLogout(d)).resolves.toBeUndefined();
    // flush denendi ama düştü → yine de logout tamamlandı
    expect(d.clearAuth).toHaveBeenCalled();
    expect(d.clearQueryCache).toHaveBeenCalled();
  });
});

describe('flushThenSwitch', () => {
  it('ONLINE: flush ÖNCE setAuth; clear() flush sonrası + setAuth öncesi', async () => {
    const d = makeDeps(true);
    await flushThenSwitch(d, { user: userB, token: 'tok-b', fullName: 'Operatör B' });
    expect(d.calls).toEqual([
      'flush',
      'closeSession',
      'resetSession',
      'clear',
      'setAuth',
      'initSession',
    ]);
    expect(d.calls.indexOf('flush')).toBeLessThan(d.calls.indexOf('setAuth'));
    expect(d.calls.indexOf('clear')).toBeGreaterThan(d.calls.indexOf('flush'));
    expect(d.calls.indexOf('clear')).toBeLessThan(d.calls.indexOf('setAuth'));
    expect(d.setAuth).toHaveBeenCalledWith(userB, 'tok-b', 'Operatör B');
  });

  it('OFFLINE: flush yok ama geçiş tamamlanır', async () => {
    const d = makeDeps(false);
    await flushThenSwitch(d, { user: userB, token: 'tok-b' });
    expect(d.resumePausedMutations).not.toHaveBeenCalled();
    expect(d.calls).toEqual(['closeSession', 'resetSession', 'clear', 'setAuth', 'initSession']);
    expect(d.setAuth).toHaveBeenCalledWith(userB, 'tok-b', undefined);
  });
});
