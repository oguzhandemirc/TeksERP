import {
  CANCEL_REASON_FALLBACK_MESSAGE,
  cancelReasonRejection,
  mainConfirmLocked,
  reasonRequiredOf,
  typedReasonOf,
} from './rollCancelRules';

// =============================================================================
// TOP İPTALİ — sebep zorunluluğu SUNUCUDAN okunur (bayrak tahmin edilmez); saf kurallar.
// =============================================================================

describe('reasonRequiredOf', () => {
  it('§1 önizleme reasonRequired:true → zorunlu; false/alan yok (ESKİ sunucu) → opsiyonel', () => {
    expect(reasonRequiredOf({ reasonRequired: true }, false)).toBe(true);
    expect(reasonRequiredOf({ reasonRequired: false }, false)).toBe(false);
    expect(reasonRequiredOf({}, false)).toBe(false);
    expect(reasonRequiredOf(null, false)).toBe(false);
  });
  it('§1b çevrimdışı → önizleme yok, opsiyonel (kuyruk; kapı sunucuda replay anında)', () => {
    expect(reasonRequiredOf({ reasonRequired: true }, true)).toBe(false);
  });
});

describe('typedReasonOf / mainConfirmLocked', () => {
  it('§2 serbest metin yalnız ≥ 3 karakterse sebep; boşluk kırpılır', () => {
    expect(typedReasonOf('  ab ')).toBeUndefined();
    expect(typedReasonOf(' abc ')).toBe('abc');
  });
  it('§3 ana düğme: zorunlu ∧ metin yok → kilitli; opsiyonel → hiç kilitlenmez', () => {
    expect(mainConfirmLocked({ reasonRequired: true, typedReason: undefined })).toBe(true);
    expect(mainConfirmLocked({ reasonRequired: true, typedReason: 'abc' })).toBe(false);
    expect(mainConfirmLocked({ reasonRequired: false, typedReason: undefined })).toBe(false);
  });
});

describe('cancelReasonRejection', () => {
  const mk = (status: number | string, code?: string, message = 'Top iptali için sebep zorunlu (ayar).') =>
    Object.assign(new Error(message), { status, details: code ? { code } : undefined });
  it('§4 400 CANCEL_REASON_REQUIRED → o top için red (sunucu mesajıyla)', () => {
    expect(cancelReasonRejection(mk(400, 'CANCEL_REASON_REQUIRED'), 'r1')).toEqual({
      rollId: 'r1',
      message: 'Top iptali için sebep zorunlu (ayar).',
    });
  });
  it('§4b mesajsız redde sabit Türkçe cümle', () => {
    expect(cancelReasonRejection(mk(400, 'CANCEL_REASON_REQUIRED', '  '), 'r1')?.message).toBe(
      CANCEL_REASON_FALLBACK_MESSAGE,
    );
  });
  it('§5 başka kod / başka durum / kodsuz 400 / ağ hatası → null (toast yolu)', () => {
    expect(cancelReasonRejection(mk(400, 'VALIDATION'), 'r1')).toBeNull();
    expect(cancelReasonRejection(mk(409, 'CANCEL_REASON_REQUIRED'), 'r1')).toBeNull();
    expect(cancelReasonRejection(mk(400), 'r1')).toBeNull();
    expect(cancelReasonRejection(mk('ERR'), 'r1')).toBeNull();
    expect(cancelReasonRejection(null, 'r1')).toBeNull();
  });
});
