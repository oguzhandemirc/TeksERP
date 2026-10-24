// bildirim: gelen kutusu bayrağının tablet aynası — eski sunucu alanı göndermez, çöp değer gelebilir;
// her iki durumda da bugünkü davranış (kapalı) sürer.
import { DEFAULT_FEATURE_FLAGS, resolveNotificationInboxEnabled } from './featureFlag.service';

describe('bildirim.gelenKutusuEnabled tablet aynası', () => {
  it('varsayılan kapalı (fail-closed)', () => {
    expect(DEFAULT_FEATURE_FLAGS.bildirimGelenKutusuEnabled).toBe(false);
    expect(resolveNotificationInboxEnabled(DEFAULT_FEATURE_FLAGS)).toBe(false);
  });

  it('eski sunucu: alan yok / yük yok → kapalı', () => {
    expect(resolveNotificationInboxEnabled({})).toBe(false);
    expect(resolveNotificationInboxEnabled(undefined)).toBe(false);
    expect(resolveNotificationInboxEnabled(null)).toBe(false);
  });

  it('tanınmayan değer → kapalı; yalnız gerçek true açar', () => {
    expect(resolveNotificationInboxEnabled({ bildirimGelenKutusuEnabled: 'true' as unknown as boolean })).toBe(false);
    expect(resolveNotificationInboxEnabled({ bildirimGelenKutusuEnabled: 1 as unknown as boolean })).toBe(false);
    expect(resolveNotificationInboxEnabled({ bildirimGelenKutusuEnabled: true })).toBe(true);
  });
});
