import { DEFAULT_FEATURE_FLAGS, resolveShadeEntryEnabled } from './featureFlag.service';

// Ton grubu aynası: backend `shipping.shadeMixPolicy` (off | warn | block, satır-yok = off).
describe('resolveShadeEntryEnabled', () => {
  it('varsayılan bugünkü davranış: ton girişi kapalı', () => {
    expect(DEFAULT_FEATURE_FLAGS.shippingShadeMixPolicy).toBe('off');
    expect(resolveShadeEntryEnabled(DEFAULT_FEATURE_FLAGS)).toBe(false);
  });

  it('eski sunucu (alan yok) / yüklenmemiş bayrak → kapalı', () => {
    expect(resolveShadeEntryEnabled({})).toBe(false);
    expect(resolveShadeEntryEnabled(undefined)).toBe(false);
    expect(resolveShadeEntryEnabled(null)).toBe(false);
  });

  it('warn ve block → açık; tanınmayan değer → kapalı', () => {
    expect(resolveShadeEntryEnabled({ shippingShadeMixPolicy: 'warn' })).toBe(true);
    expect(resolveShadeEntryEnabled({ shippingShadeMixPolicy: 'block' })).toBe(true);
    expect(resolveShadeEntryEnabled({ shippingShadeMixPolicy: 'BLOCK' as never })).toBe(false);
  });
});
