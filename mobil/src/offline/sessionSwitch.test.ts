// clearUserScopedQueries — logout temizliğinin İKİ kritik sözleşmesi:
// (1) public bootstrap query'leri korunur (login ekranı cache'ten anında çizilir),
// (2) mutation cache'ine ASLA dokunulmaz (tavanla bekletilen outbox yok olmasın).

// sessionSwitch → sessionStore → workSession.service → api zinciri testte
// axios/native çekmesin diye servis katmanı mock'lanır.
jest.mock('../services/workSession.service', () => ({
  workSessionService: {
    current: jest.fn(),
    open: jest.fn(),
    close: jest.fn(),
    places: jest.fn(),
  },
}));
jest.mock('../services/api', () => ({
  resolveAuthToken: jest.fn(async () => 'test-token'),
}));

import { queryClient } from './queryClient';
import { clearUserScopedQueries } from './sessionSwitch';

afterEach(() => {
  queryClient.clear();
});

describe('clearUserScopedQueries', () => {
  it('bootstrap korunur; kullanıcıya özel query silinir', () => {
    queryClient.setQueryData(['auth', 'mobile-users'], { data: [{ id: 'u1' }] });
    queryClient.setQueryData(['auth', 'login-methods'], { enabled: ['list'], primary: 'list' });
    queryClient.setQueryData(['feature-flags'], { rawWidthEnabled: false });
    queryClient.setQueryData(['device', 'status'], { status: 'APPROVED' });
    queryClient.setQueryData(['rolls', 'kk1', 'history'], [{ id: 'r1' }]);
    queryClient.setQueryData(['preferences'], { moduleOrder: [] });
    queryClient.setQueryData(['work-orders', 'list'], [{ id: 'w1' }]);

    clearUserScopedQueries();

    // Korunanlar (login ekranı bootstrap'ı):
    expect(queryClient.getQueryData(['auth', 'mobile-users'])).toBeDefined();
    expect(queryClient.getQueryData(['auth', 'login-methods'])).toBeDefined();
    expect(queryClient.getQueryData(['feature-flags'])).toBeDefined();
    expect(queryClient.getQueryData(['device', 'status'])).toBeDefined();
    // Silinenler (kullanıcıya özel):
    expect(queryClient.getQueryData(['rolls', 'kk1', 'history'])).toBeUndefined();
    expect(queryClient.getQueryData(['preferences'])).toBeUndefined();
    expect(queryClient.getQueryData(['work-orders', 'list'])).toBeUndefined();
  });

  it('mutation cache\'ine DOKUNMAZ — bekletilen outbox kaydı yaşar', () => {
    const cache = queryClient.getMutationCache();
    cache.build(queryClient, {
      mutationKey: ['station', 'kk1-create-entry'],
      mutationFn: async () => ({}),
    });
    expect(cache.getAll()).toHaveLength(1);

    clearUserScopedQueries();

    // queryClient.clear() olsaydı bu 0 olurdu — outbox'ı silmek veri kaybıdır.
    expect(cache.getAll()).toHaveLength(1);
  });
});
