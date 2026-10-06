// =============================================================================
// usePasswordChangeStep — yönetici sıfırlamasından sonra tablette zorunlu parola değişimi
// =============================================================================
//   §1 parolalı giriş dalı: elde token + mevcut parola → change-password o token'la, sonra resume
//   §2 yeni parolalar eşleşmezse sunucuya gidilmez, adımda hata
//   §3 PIN/kart dalı: önce değişim adımlı parolalı giriş (geçici parola), dönen token'la değişim
//   §4 sunucu reddi adımda kalır; yeniden denemede aynı token kullanılır (ikinci giriş yok)
//   §5 vazgeç: kısıtlı token'ın oturumu kapatılır
//   §6 passwordChangeUsername yalnız 403 PASSWORD_CHANGE_REQUIRED + kullanıcı adında döner
//   §7 parolalı giriş gövdesi değişim adımını bildirir (passwordChangeCapable)
// =============================================================================
import { act, renderHook } from '@testing-library/react-native';
import { authService } from '../../services/auth.service';
import { apiClient } from '../../services/api';
import { passwordChangeUsername, usePasswordChangeStep } from './usePasswordChangeStep';

jest.mock('../../services/api', () => ({
  apiClient: { post: jest.fn(() => Promise.resolve({ data: {} })), get: jest.fn() },
}));

let login: jest.SpyInstance;
let change: jest.SpyInstance;
let logout: jest.SpyInstance;

beforeEach(() => {
  login = jest.spyOn(authService, 'login');
  change = jest.spyOn(authService, 'changePassword').mockResolvedValue(undefined);
  logout = jest.spyOn(authService, 'logoutToken').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

const gecerli = { currentPassword: '', newPassword: 'Yeni-Parola-1', confirm: 'Yeni-Parola-1' };

it('§1 parolalı giriş dalı: token ile değiştirir, yeni parolayla resume', async () => {
  const resume = jest.fn(() => Promise.resolve());
  const { result } = renderHook(() => usePasswordChangeStep());
  act(() => result.current.open({ username: 'ali', currentPassword: 'Gecici-123', token: 'T1', resume }));
  await act(async () => {
    await result.current.submit(gecerli);
  });
  expect(login).not.toHaveBeenCalled();
  expect(change).toHaveBeenCalledWith('T1', 'Gecici-123', 'Yeni-Parola-1');
  expect(resume).toHaveBeenCalledWith('Yeni-Parola-1');
  expect(result.current.pending).toBeNull();
});

it('§2 eşleşmeyen yeni parola sunucuya gitmez', async () => {
  const resume = jest.fn(() => Promise.resolve());
  const { result } = renderHook(() => usePasswordChangeStep());
  act(() => result.current.open({ username: 'ali', currentPassword: 'x', token: 'T1', resume }));
  await act(async () => {
    await result.current.submit({ ...gecerli, confirm: 'baska' });
  });
  expect(change).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/eşleşmiyor/);
  expect(result.current.pending).not.toBeNull();
});

it('§3 PIN/kart dalı: geçici parolayla kısıtlı token alır, sonra değiştirir', async () => {
  login.mockResolvedValue({ success: true, message: '', data: { token: 'T2', user: {}, mustChangePassword: true } });
  const resume = jest.fn(() => Promise.resolve());
  const { result } = renderHook(() => usePasswordChangeStep());
  act(() => result.current.open({ username: 'ali', resume }));
  await act(async () => {
    await result.current.submit({ ...gecerli, currentPassword: 'Gecici-123' });
  });
  expect(login).toHaveBeenCalledWith({ username: 'ali', password: 'Gecici-123' });
  expect(change).toHaveBeenCalledWith('T2', 'Gecici-123', 'Yeni-Parola-1');
  expect(resume).toHaveBeenCalled();
});

it('§4 sunucu reddi adımda kalır; yeniden deneme aynı token', async () => {
  login.mockResolvedValue({ success: true, message: '', data: { token: 'T3', user: {}, mustChangePassword: true } });
  change.mockRejectedValueOnce(new Error('Parola en az 10 karakter olmalı.'));
  const resume = jest.fn(() => Promise.resolve());
  const { result } = renderHook(() => usePasswordChangeStep());
  act(() => result.current.open({ username: 'ali', resume }));
  await act(async () => {
    await result.current.submit({ ...gecerli, currentPassword: 'Gecici-123' });
  });
  expect(result.current.error).toMatch(/10 karakter/);
  expect(resume).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.submit({ ...gecerli, currentPassword: 'Gecici-123' });
  });
  expect(login).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenLastCalledWith('T3', 'Gecici-123', 'Yeni-Parola-1');
  expect(resume).toHaveBeenCalledTimes(1);
});

it('§5 vazgeç kısıtlı token oturumunu kapatır', () => {
  const { result } = renderHook(() => usePasswordChangeStep());
  act(() => result.current.open({ username: 'ali', currentPassword: 'x', token: 'T4', resume: jest.fn() }));
  act(() => result.current.cancel());
  expect(logout).toHaveBeenCalledWith('T4');
  expect(result.current.pending).toBeNull();
});

it('§6 passwordChangeUsername', () => {
  expect(passwordChangeUsername({ status: 403, details: { code: 'PASSWORD_CHANGE_REQUIRED', username: 'ali' } })).toBe('ali');
  expect(passwordChangeUsername({ status: 403, details: { code: 'PASSWORD_CHANGE_REQUIRED' } })).toBeNull();
  expect(passwordChangeUsername({ status: 403, details: { code: 'DEVICE_NOT_APPROVED', username: 'ali' } })).toBeNull();
  expect(passwordChangeUsername(null)).toBeNull();
});

it('§7 parolalı giriş gövdesi passwordChangeCapable taşır', async () => {
  jest.restoreAllMocks();
  const post = apiClient.post as jest.Mock;
  post.mockClear();
  await authService.login({ username: 'ali', password: 'p' });
  expect(post.mock.calls[0][0]).toBe('/auth/login');
  expect(post.mock.calls[0][1]).toMatchObject({ clientType: 'mobile', passwordChangeCapable: true });
});
