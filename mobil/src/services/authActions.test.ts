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

// Y-02: PIN/kart girişinde ikinci faktör — 409 TOTP_REQUIRED → kod sorulur, totpCode ile tekrar.
const totpRequired = () =>
  Object.assign(new Error('Doğrulama kodu gerekli.'), { status: 409, details: { code: 'TOTP_REQUIRED' } });
const totpInvalid = () =>
  Object.assign(new Error('Doğrulama kodu geçersiz.'), { status: 401, details: { code: 'TOTP_INVALID' } });

describe('authActions — ikinci faktör (TOTP) adımı', () => {
  it('quickPin: TOTP_REQUIRED → kod sorulur, totpCode ile tekrar', async () => {
    svc.loginWithQuickPin.mockRejectedValueOnce(totpRequired()).mockResolvedValueOnce(okRes('sa'));
    const onTotp = jest.fn(async () => '123456');
    const res = await authActions.quickPin('654321', undefined, onTotp);
    expect(res.data.user.username).toBe('sa');
    expect(onTotp).toHaveBeenCalledWith(false);
    expect(svc.loginWithQuickPin).toHaveBeenNthCalledWith(2, '654321', undefined, '123456');
  });

  it('card: yanlış kod (TOTP_INVALID) → kod yeniden sorulur (invalid=true)', async () => {
    svc.loginWithCard
      .mockRejectedValueOnce(totpRequired())
      .mockRejectedValueOnce(totpInvalid())
      .mockResolvedValueOnce(okRes('sa'));
    const onTotp = jest.fn().mockResolvedValueOnce('111111').mockResolvedValueOnce('222222');
    await authActions.card('TEKSU:1:tok', undefined, onTotp);
    expect(onTotp).toHaveBeenNthCalledWith(1, false);
    expect(onTotp).toHaveBeenNthCalledWith(2, true);
    expect(svc.loginWithCard).toHaveBeenNthCalledWith(3, 'TEKSU:1:tok', undefined, '222222');
  });

  it('vazgeçilirse giriş yapılmaz, tekrar yok', async () => {
    svc.loginWithQuickPin.mockRejectedValueOnce(totpRequired());
    await expect(authActions.quickPin('654321', undefined, async () => null)).rejects.toThrow(
      'Doğrulama kodu girilmedi',
    );
    expect(svc.loginWithQuickPin).toHaveBeenCalledTimes(1);
  });

  it('resolver yoksa TOTP_REQUIRED aynen fırlar (eski çağıran)', async () => {
    svc.loginWithQuickPin.mockRejectedValueOnce(totpRequired());
    await expect(authActions.quickPin('654321')).rejects.toThrow('Doğrulama kodu gerekli.');
  });

  it('password: kod login gövdesine totpCode olarak girer', async () => {
    svc.login.mockRejectedValueOnce(totpRequired()).mockResolvedValueOnce(okRes('op'));
    await authActions.password('op', 'pass', undefined, async () => '123456');
    expect(svc.login).toHaveBeenNthCalledWith(2, {
      username: 'op',
      password: 'pass',
      confirmKick: undefined,
      totpCode: '123456',
    });
  });
});
