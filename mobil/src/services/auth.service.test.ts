import { apiClient } from './api';
import { authService } from './auth.service';
import { CHANGE_PASSWORD_TIMEOUT_MS } from '../constants/api';

// jest.mock babel-jest ile import'ların üstüne kaldırılır; sıra davranışı değiştirmez.
jest.mock('./api', () => ({ apiClient: { post: jest.fn(() => Promise.resolve({ data: {} })) } }));
jest.mock('./featureFlag.service', () => ({ DEFAULT_COMPANY_NAME: 'TeksERP' }));

// Parola değişimi üç bcrypt yapar; genel 10 sn zaman aşımı yüklü sunucuda isteği kesiyordu
// ("Sunucuya ulaşılamıyor"). Yalnız bu çağrı 30 sn bekler.
describe('authService.changePassword', () => {
  it('istek başına 30 sn zaman aşımı + kısıtlı token başlığı', async () => {
    await authService.changePassword('tok', 'eski-parola', 'yeni-parola');
    expect(CHANGE_PASSWORD_TIMEOUT_MS).toBe(30_000);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/auth/change-password',
      { currentPassword: 'eski-parola', newPassword: 'yeni-parola' },
      { headers: { Authorization: 'Bearer tok' }, timeout: 30_000 },
    );
  });
});
