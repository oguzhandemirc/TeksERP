jest.mock('./auth.service', () => ({
  authService: {
    login: jest.fn(),
    loginWithQuickPin: jest.fn(),
    loginWithCard: jest.fn(),
  },
}));

import { authActions } from './authActions';
import { authService } from './auth.service';
import type { LoginResponse } from '../types/auth';

const svc = authService as jest.Mocked<typeof authService>;

const okRes = (username: string): LoginResponse => ({
  success: true,
  data: { token: 'tok', user: { userId: 'u', username, permissions: [] } },
  message: 'ok',
});

const sessionExists = (existing?: unknown) =>
  Object.assign(new Error('Oturum zaten açık'), {
    status: 409,
    details: { code: 'SESSION_EXISTS', existingSession: existing },
  });

beforeEach(() => jest.clearAllMocks());

describe('authActions.quickPin', () => {
  it('ilk denemede başarı → onConflict çağrılmaz, confirmKick undefined', async () => {
    svc.loginWithQuickPin.mockResolvedValueOnce(okRes('ali'));
    const onConflict = jest.fn();
    const res = await authActions.quickPin('123456', onConflict);
    expect(res.data.user.username).toBe('ali');
    expect(onConflict).not.toHaveBeenCalled();
    expect(svc.loginWithQuickPin).toHaveBeenCalledTimes(1);
    expect(svc.loginWithQuickPin).toHaveBeenCalledWith('123456', undefined);
  });

  it('SESSION_EXISTS + onConflict true → confirmKick=true ile tekrar', async () => {
    const existing = { deviceType: 'mobile', createdAt: 'x', deviceId: 'd1' };
    svc.loginWithQuickPin
      .mockRejectedValueOnce(sessionExists(existing))
      .mockResolvedValueOnce(okRes('veli'));
    const onConflict = jest.fn(async () => true);
    const res = await authActions.quickPin('123456', onConflict);
    expect(res.data.user.username).toBe('veli');
    expect(onConflict).toHaveBeenCalledWith(existing);
    expect(svc.loginWithQuickPin).toHaveBeenNthCalledWith(2, '123456', true);
  });

  it('SESSION_EXISTS + onConflict false → hata fırlar, tekrar YOK', async () => {
    svc.loginWithQuickPin.mockRejectedValueOnce(sessionExists());
    const onConflict = jest.fn(async () => false);
    await expect(authActions.quickPin('123456', onConflict)).rejects.toThrow('Oturum zaten açık');
    expect(svc.loginWithQuickPin).toHaveBeenCalledTimes(1);
  });

  it('resolver yoksa SESSION_EXISTS → sessizce confirmKick ile devam (kick benzeri)', async () => {
    svc.loginWithQuickPin
      .mockRejectedValueOnce(sessionExists())
      .mockResolvedValueOnce(okRes('can'));
    const res = await authActions.quickPin('123456');
    expect(res.data.user.username).toBe('can');
    expect(svc.loginWithQuickPin).toHaveBeenNthCalledWith(2, '123456', true);
  });

  it('409 ama SESSION_EXISTS değil → rethrow, onConflict çağrılmaz', async () => {
    svc.loginWithQuickPin.mockRejectedValueOnce(
      Object.assign(new Error('başka'), { status: 409, details: { code: 'OTHER' } }),
    );
    const onConflict = jest.fn();
    await expect(authActions.quickPin('123456', onConflict)).rejects.toThrow('başka');
    expect(onConflict).not.toHaveBeenCalled();
    expect(svc.loginWithQuickPin).toHaveBeenCalledTimes(1);
  });

  it('401 (yanlış PIN) → rethrow, tekrar yok', async () => {
    svc.loginWithQuickPin.mockRejectedValueOnce(
      Object.assign(new Error('PIN yanlış'), { status: 401 }),
    );
    await expect(authActions.quickPin('123456', jest.fn())).rejects.toThrow('PIN yanlış');
    expect(svc.loginWithQuickPin).toHaveBeenCalledTimes(1);
  });
});

describe('authActions.password', () => {
  it('login gövdesine confirmKick geçirir (retry akışı)', async () => {
    svc.login.mockRejectedValueOnce(sessionExists()).mockResolvedValueOnce(okRes('op'));
    await authActions.password('op', 'pass', async () => true);
    expect(svc.login).toHaveBeenNthCalledWith(1, { username: 'op', password: 'pass', confirmKick: undefined });
    expect(svc.login).toHaveBeenNthCalledWith(2, { username: 'op', password: 'pass', confirmKick: true });
  });
});

describe('authActions.card', () => {
  it('başarı → confirmKick undefined', async () => {
    svc.loginWithCard.mockResolvedValueOnce(okRes('kart'));
    await authActions.card('TEKSU:1:tok');
    expect(svc.loginWithCard).toHaveBeenCalledWith('TEKSU:1:tok', undefined);
  });
});
