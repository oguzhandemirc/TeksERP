// =============================================================================
// Bekçi: Sevk Kapısı cari kilit çipi + 409 CARI_HOLD tam ekranı (D4-I4)
// =============================================================================
// Kilitlenen sözleşme:
//   • çip yalnız sunucu `held: true` + `holdText` gönderince; eski backend (alan yok) → çip yok,
//   • 409 `details.code === 'CARI_HOLD'` → tam ekran, metin SUNUCUNUN mesajı (istemci üretmez),
//   • başka 409 / kodsuz hata → tam ekran AÇILMAZ (eski tost yolu),
//   • SevkiyatScreen bu yardımcıları bağlar (dispatch onError + kart çipi).
// =============================================================================

import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { CariHoldBlockedScreen, CariHoldChip, cariHoldBlockFromError, holdChipText } from './CariHold';

const SERVER_MSG =
  'Bu müşterinin carisi kilitli (Borç) — sevk durduruldu. Kilidi Ayşe Yılmaz 31.10.2026 10:00 tarihinde koydu. ' +
  'Kilidi yalnız "Cari kilidini aç" yetkisi olan kişi (Muhasebe) açabilir.';

function err(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, details });
}

describe('holdChipText — çip yalnız sunucu söyleyince', () => {
  it('held + metin → sunucunun metni', () => {
    expect(holdChipText({ held: true, holdText: 'Cari kilitli (sevk) — müşterinin kendi emaneti sevk edilir' })).toBe(
      'Cari kilitli (sevk) — müşterinin kendi emaneti sevk edilir',
    );
  });
  it('eski backend (alan yok) → null, çip yok', () => {
    expect(holdChipText({})).toBeNull();
  });
  it('held=false ya da metin boş/null → null', () => {
    expect(holdChipText({ held: false, holdText: 'x' })).toBeNull();
    expect(holdChipText({ held: true, holdText: null })).toBeNull();
    expect(holdChipText({ held: true, holdText: '' })).toBeNull();
  });
});

describe('cariHoldBlockFromError — 409 CARI_HOLD ayrımı', () => {
  it('409 CARI_HOLD → sunucu mesajı + koyan', () => {
    expect(cariHoldBlockFromError(err(409, SERVER_MSG, { code: 'CARI_HOLD', koyan: 'Ayşe Yılmaz' }))).toEqual({
      message: SERVER_MSG,
      placedBy: 'Ayşe Yılmaz',
    });
  });
  it('başka 409 kodu, kodsuz 409, 403 ve ağ hatası → null (tost yolu)', () => {
    expect(cariHoldBlockFromError(err(409, 'x', { code: 'SHIPMENT_STATUS_CHANGED' }))).toBeNull();
    expect(cariHoldBlockFromError(err(409, 'x'))).toBeNull();
    expect(cariHoldBlockFromError(err(403, 'x', { code: 'CARI_HOLD' }))).toBeNull();
    expect(cariHoldBlockFromError(new Error('Sunucuya ulaşılamıyor'))).toBeNull();
    expect(cariHoldBlockFromError(null)).toBeNull();
  });
});

describe('CariHoldBlockedScreen — tam ekran', () => {
  it('blok varken sunucu metnini gösterir ve Anladım kapatır', () => {
    const onClose = jest.fn();
    renderWithPaper(<CariHoldBlockedScreen block={{ message: SERVER_MSG, placedBy: 'Ayşe Yılmaz' }} onClose={onClose} />);
    expect(screen.getByTestId('cari-kilit-ekrani')).toBeTruthy();
    expect(screen.getByTestId('cari-kilit-mesaj').props.children).toBe(SERVER_MSG);
    expect(screen.getByText(/açabilir/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('cari-kilit-tamam'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('blok yokken çizilmez', () => {
    renderWithPaper(<CariHoldBlockedScreen block={null} onClose={() => {}} />);
    expect(screen.queryByTestId('cari-kilit-ekrani')).toBeNull();
  });
});

describe('CariHoldChip', () => {
  it('metni gösterir', () => {
    renderWithPaper(<CariHoldChip text="Cari kilitli (sevk) — emanet dahil sevk durur" testID="cip" />);
    expect(screen.getByTestId('cip')).toBeTruthy();
    expect(screen.getByText('Cari kilitli (sevk) — emanet dahil sevk durur')).toBeTruthy();
  });
});

describe('SevkiyatScreen bağlantısı', () => {
  const src = readFileSync(path.join(__dirname, 'SevkiyatScreen.tsx'), 'utf8');
  it('dispatch onError tam ekranı cariHoldBlockFromError ile açar, kart çipi holdChipText ile', () => {
    expect(src).toMatch(/cariHoldBlockFromError\(e\)/);
    expect(src).toMatch(/<CariHoldBlockedScreen block=\{holdBlock\}/);
    expect(src).toMatch(/holdChipText\(sh\)/);
  });
  it('istemci kilit metni üretmez (ekranda "kilitli" literal yok)', () => {
    expect(src).not.toMatch(/['"`][^'"`]*kilitli[^'"`]*['"`]/i);
  });
});
