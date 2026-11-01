// =============================================================================
// Bekçi: tablette yerinde yönetici onayı (eşleme v2, plan §6.4)
// =============================================================================
// NEGATİF SONDA (ölçüldü 2026-10-25): gönderimde parola/kod silinmeyince 1 kırmızı (§3); TOTP_REQUIRED
// dalı kod alanını açmayınca 1 kırmızı (§3); api.ts'te onsite-approve oturum-düşürme muafiyeti
// kalkınca 1 kırmızı (§6).
// =============================================================================
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithPaper } from '../../test/render';
import { deviceService } from '../../services/device.service';
import OnsiteRebindApprove, { onsiteErrorMessage } from './OnsiteRebindApprove';

jest.mock('../../services/device.service', () => ({
  deviceService: { onsiteApproveRebind: jest.fn() },
}));

const approve = deviceService.onsiteApproveRebind as jest.Mock;
const LOCAL = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function setup() {
  const onSettled = jest.fn();
  renderWithPaper(<OnsiteRebindApprove localId={LOCAL} onSettled={onSettled} />);
  fireEvent.press(screen.getByTestId('yerinde-onay-ac'));
  return { onSettled };
}

async function fillAndSend(user = '  yonetici ', pw = 'Gizli-1') {
  fireEvent.changeText(screen.getByTestId('yerinde-kullanici-adi'), user);
  fireEvent.changeText(screen.getByTestId('yerinde-parola'), pw);
  await act(async () => {
    fireEvent.press(screen.getByTestId('yerinde-onayla'));
  });
}

describe('OnsiteRebindApprove', () => {
  beforeEach(() => approve.mockReset());

  it('§1 kapalı başlar; düğme formu açar; boş form gönderilmez', async () => {
    setup();
    expect(screen.getByTestId('yerinde-onay-formu')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('yerinde-onayla'));
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it('§2 gövde {localId, kırpılmış ad, ham parola}; parola state temizlenir; başarıda onSettled', async () => {
    approve.mockResolvedValue({ targetName: 'Tambur-1 Tablet', status: 'APPROVED' });
    const { onSettled } = setup();
    fireEvent.changeText(screen.getByTestId('yerinde-kullanici-adi'), '  yonetici ');
    fireEvent.changeText(screen.getByTestId('yerinde-parola'), 'Gizli-1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('yerinde-onayla'));
    });
    expect(approve).toHaveBeenCalledWith({ localId: LOCAL, username: 'yonetici', password: 'Gizli-1' });
    expect(onSettled).toHaveBeenCalledTimes(1);
    // Başarıda form kapanır; yeniden açılınca parola boş.
    fireEvent.press(screen.getByTestId('yerinde-onay-ac'));
    expect(screen.getByTestId('yerinde-parola').props.value).toBe('');
  });

  it('§3 409 TOTP_REQUIRED → 2FA alanı açılır, parola silinmiş, kodla yeniden gönderilir', async () => {
    approve.mockRejectedValueOnce({ status: 409, details: { code: 'TOTP_REQUIRED' } });
    setup();
    await fillAndSend();
    expect(screen.getByTestId('yerinde-parola').props.value).toBe('');
    expect(screen.getByTestId('yerinde-totp')).toBeOnTheScreen();
    expect(screen.getByTestId('yerinde-hata')).toHaveTextContent(/doğrulama kodu gerekiyor/);
    approve.mockResolvedValueOnce({ targetName: 'X', status: 'APPROVED' });
    fireEvent.changeText(screen.getByTestId('yerinde-parola'), 'Gizli-1');
    fireEvent.changeText(screen.getByTestId('yerinde-totp'), '123456');
    await act(async () => {
      fireEvent.press(screen.getByTestId('yerinde-onayla'));
    });
    expect(approve).toHaveBeenLastCalledWith({ localId: LOCAL, username: 'yonetici', password: 'Gizli-1', totp: '123456' });
  });

  it('§4 hata iletileri Türkçe ve koda göre', () => {
    expect(onsiteErrorMessage({ status: 401, details: {} }).text).toBe('Kullanıcı adı veya parola hatalı.');
    expect(onsiteErrorMessage({ status: 429, details: { code: 'LOGIN_LOCKED', retryAfterSec: 120 } }).text).toMatch(/kilitli\. 2 dakika/);
    expect(onsiteErrorMessage({ status: 403, details: { code: 'REBIND_APPROVER_FORBIDDEN' } }).text).toMatch(/admin:settings/);
    const settled = onsiteErrorMessage({ status: 409, details: { code: 'REBIND_ALREADY_DECIDED' } });
    expect(settled.settled).toBe(true);
    expect(onsiteErrorMessage({ status: 404, details: { code: 'REBIND_REQUEST_NOT_FOUND' } }).settled).toBe(true);
    expect(onsiteErrorMessage({}).text).toMatch(/Sunucuya ulaşılamadı/);
    expect(onsiteErrorMessage({ status: 503, details: { code: 'AUTH_BUSY' } }).text).toMatch(/çok yoğun/);
  });

  it('§5 talep zaten işlenmiş → hata gösterilir ve durum yeniden çekilir', async () => {
    approve.mockRejectedValueOnce({ status: 409, details: { code: 'REBIND_ALREADY_DECIDED' } });
    const { onSettled } = setup();
    await fillAndSend();
    expect(screen.getByTestId('yerinde-hata')).toHaveTextContent(/zaten işlenmiş/);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('§6 yanlış parola 401 oturumu düşürmez (api.ts muafiyeti)', () => {
    const src = readFileSync(join(__dirname, '../../services/api.ts'), 'utf8');
    expect(src).toMatch(/isLoginCall\s*=.*'\/rebind-requests\/onsite-approve'/);
  });
});
