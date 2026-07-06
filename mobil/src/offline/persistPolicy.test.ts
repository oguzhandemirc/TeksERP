import {
  BOOTSTRAP_QUERY_KEYS,
  PERSISTED_QUERY_KEYS,
  keyStartsWith,
  isBootstrapQueryKey,
  isPersistedQueryKey,
  isStationMutationKey,
  shouldPersistMutation,
} from './persistPolicy';

describe('keyStartsWith', () => {
  it('tam prefix eşleşir; alt anahtarlar da kapsanır', () => {
    expect(keyStartsWith(['auth', 'mobile-users'], ['auth', 'mobile-users'])).toBe(true);
    expect(keyStartsWith(['auth', 'mobile-users', 'x'], ['auth', 'mobile-users'])).toBe(true);
  });
  it('kısmi/yanlış prefix eşleşmez', () => {
    expect(keyStartsWith(['auth'], ['auth', 'mobile-users'])).toBe(false);
    expect(keyStartsWith(['auth', 'login-methods'], ['auth', 'mobile-users'])).toBe(false);
    expect(keyStartsWith(['rolls'], ['auth', 'mobile-users'])).toBe(false);
  });
});

describe('bootstrap / persist beyaz listeleri', () => {
  it('login bootstrap anahtarları logout temizliğinden korunur', () => {
    expect(isBootstrapQueryKey(['auth', 'mobile-users'])).toBe(true);
    expect(isBootstrapQueryKey(['auth', 'login-methods'])).toBe(true);
    expect(isBootstrapQueryKey(['feature-flags'])).toBe(true);
    expect(isBootstrapQueryKey(['device', 'status'])).toBe(true);
    expect(isBootstrapQueryKey(['device', 'assignment-required'])).toBe(true);
  });

  it('kullanıcıya özel anahtarlar bootstrap DEĞİL (logout\'ta silinir)', () => {
    expect(isBootstrapQueryKey(['rolls', 'kk1', 'history'])).toBe(false);
    expect(isBootstrapQueryKey(['preferences'])).toBe(false); // tercih = kullanıcıya özel
    expect(isBootstrapQueryKey(['work-session', 'current'])).toBe(false);
    expect(isBootstrapQueryKey(['auth'])).toBe(false); // kök 'auth' HERŞEYİ kapsamamalı
  });

  it('persist listesi = bootstrap + preferences; üretim verisi ASLA persist edilmez', () => {
    expect(isPersistedQueryKey(['preferences'])).toBe(true);
    for (const k of BOOTSTRAP_QUERY_KEYS) expect(isPersistedQueryKey([...k])).toBe(true);
    expect(isPersistedQueryKey(['rolls', 'kk1', 'history'])).toBe(false);
    expect(isPersistedQueryKey(['work-orders'])).toBe(false);
    expect(PERSISTED_QUERY_KEYS.length).toBe(BOOTSTRAP_QUERY_KEYS.length + 1);
  });
});

describe('shouldPersistMutation (paused ∪ pending-istasyon)', () => {
  const m = (state: { isPaused: boolean; status: string }, mutationKey?: unknown) => ({
    state,
    options: { mutationKey },
  });

  it('paused mutation HER ZAMAN persist (default davranış korunur)', () => {
    expect(shouldPersistMutation(m({ isPaused: true, status: 'pending' }, ['station', 'x']))).toBe(true);
    expect(shouldPersistMutation(m({ isPaused: true, status: 'pending' }, ['baska']))).toBe(true);
  });

  it('pending İSTASYON mutation persist (aktif retry app kill\'de kaybolmasın)', () => {
    expect(shouldPersistMutation(m({ isPaused: false, status: 'pending' }, ['station', 'kk1-create-entry']))).toBe(true);
  });

  it('pending ama istasyon-dışı persist EDİLMEZ', () => {
    expect(shouldPersistMutation(m({ isPaused: false, status: 'pending' }, ['preferences', 'save']))).toBe(false);
    expect(shouldPersistMutation(m({ isPaused: false, status: 'pending' }, undefined))).toBe(false);
  });

  it('tamamlanmış/idle mutation persist edilmez (yer kaplamasın)', () => {
    expect(shouldPersistMutation(m({ isPaused: false, status: 'success' }, ['station', 'x']))).toBe(false);
    expect(shouldPersistMutation(m({ isPaused: false, status: 'error' }, ['station', 'x']))).toBe(false);
    expect(shouldPersistMutation(m({ isPaused: false, status: 'idle' }, ['station', 'x']))).toBe(false);
  });

  it('isStationMutationKey: yalnız ["station", ...] namespace\'i', () => {
    expect(isStationMutationKey(['station', 'qc2-complete'])).toBe(true);
    expect(isStationMutationKey(['stationX'])).toBe(false);
    expect(isStationMutationKey('station')).toBe(false);
    expect(isStationMutationKey(undefined)).toBe(false);
  });
});
