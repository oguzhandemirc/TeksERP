import {
  BOOTSTRAP_QUERY_KEYS,
  PERSISTED_QUERY_KEYS,
  keyStartsWith,
  isBootstrapQueryKey,
  isPersistedQueryKey,
  isStationMutationKey,
  shouldPersistMutation,
  revivePendingStationMutations,
  EKRANSIZ_META,
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

describe('revivePendingStationMutations (restore zombi önleme)', () => {
  const pc = (mutations: unknown) => ({ clientState: { mutations } }) as never;

  it('pending + isPaused:false İSTASYON kaydı restore öncesi paused edilir', () => {
    const persisted = pc([
      { mutationKey: ['station', 'kk1-create-entry'], state: { status: 'pending', isPaused: false } },
    ]);
    const out = revivePendingStationMutations(persisted) as {
      clientState: { mutations: { state: { isPaused: boolean } }[] };
    };
    // Bu düzeltme olmadan hydrate isPaused:false kurar ve resumePausedMutations
    // kaydı ASLA görmez (zombi → sessiz kayıt kaybı).
    expect(out.clientState.mutations[0].state.isPaused).toBe(true);
  });

  it('zaten paused olana ve istasyon-dışına DOKUNMAZ', () => {
    const persisted = pc([
      { mutationKey: ['station', 'qc2-complete'], state: { status: 'pending', isPaused: true } },
      { mutationKey: ['preferences', 'save'], state: { status: 'pending', isPaused: false } },
      { mutationKey: ['station', 'kk1-scrap'], state: { status: 'success', isPaused: false } },
    ]);
    const out = revivePendingStationMutations(persisted) as {
      clientState: { mutations: { state: { isPaused: boolean } }[] };
    };
    expect(out.clientState.mutations[0].state.isPaused).toBe(true); // değişmedi
    expect(out.clientState.mutations[1].state.isPaused).toBe(false); // istasyon değil
    expect(out.clientState.mutations[2].state.isPaused).toBe(false); // pending değil
  });

  it('bozuk/eksik yapıda güvenli (crash yok, girdi aynen döner)', () => {
    expect(revivePendingStationMutations({} as never)).toEqual({});
    expect(revivePendingStationMutations(pc(undefined))).toEqual({ clientState: { mutations: undefined } });
    expect(revivePendingStationMutations(pc([{ state: null }, {}]))).toBeDefined();
  });
});

// =============================================================================
// BULGU-T3-001 (S1) — diriltilen kayda EKRANSIZLIK damgası vurulur
// =============================================================================
describe('revivePendingStationMutations — ekransızlık damgası', () => {
  it('diriltilen istasyon kaydına damga vurulur (mevcut meta korunur)', () => {
    const persisted = {
      clientState: {
        mutations: [
          {
            mutationKey: ['station', 'kk1-create-entry'],
            state: { status: 'pending', isPaused: false },
            meta: { onceden: 1 },
          },
        ],
      },
    };
    const out = revivePendingStationMutations(persisted);
    const m = out.clientState.mutations[0] as { state: { isPaused: boolean }; meta: Record<string, unknown> };
    expect(m.state.isPaused).toBe(true);
    expect(m.meta[EKRANSIZ_META]).toBe(true);
    expect(m.meta.onceden).toBe(1);
  });

  it('istasyon-dışı ve zaten paused kayda damga VURULMAZ (idempotent)', () => {
    const persisted = {
      clientState: {
        mutations: [
          { mutationKey: ['orders', 'create'], state: { status: 'pending', isPaused: false } },
          { mutationKey: ['station', 'kk1-create-entry'], state: { status: 'pending', isPaused: true } },
        ],
      },
    };
    const out = revivePendingStationMutations(persisted);
    const list = out.clientState.mutations as Array<{ meta?: Record<string, unknown> }>;
    expect(list[0].meta?.[EKRANSIZ_META]).toBeUndefined();
    expect(list[1].meta?.[EKRANSIZ_META]).toBeUndefined();
  });
});
