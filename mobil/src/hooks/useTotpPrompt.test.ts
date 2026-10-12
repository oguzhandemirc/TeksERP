import { isSubmittableTotpCode } from './useTotpPrompt';

describe('isSubmittableTotpCode', () => {
  it('6 haneli TOTP ve kurtarma kodu gönderilebilir', () => {
    expect(isSubmittableTotpCode('123456')).toBe(true);
    expect(isSubmittableTotpCode(' 123456 ')).toBe(true);
    expect(isSubmittableTotpCode('ABCD-EF23')).toBe(true);
    expect(isSubmittableTotpCode('abcdef23')).toBe(true);
  });
  it('eksik/biçimsiz kod gönderilemez', () => {
    expect(isSubmittableTotpCode('')).toBe(false);
    expect(isSubmittableTotpCode('12345')).toBe(false);
    expect(isSubmittableTotpCode('1234567')).toBe(false);
    expect(isSubmittableTotpCode('ABC-DEFG')).toBe(false);
  });
});
