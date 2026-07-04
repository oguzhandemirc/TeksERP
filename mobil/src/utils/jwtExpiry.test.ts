import { decodeJwtExpMs, msUntilExpiry, shouldAutoLogout } from './jwtExpiry';

// base64url encode (test-yerel) — Buffer jest ortamında mevcut.
function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** exp saniye (epoch) verilen sahte ama YAPISAL geçerli JWT üret. */
function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  return `${header}.${body}.sig-not-verified`;
}

const NOW = 1_700_000_000_000; // sabit epoch ms
const NOW_SEC = Math.floor(NOW / 1000);

describe('decodeJwtExpMs', () => {
  it('geçerli token → exp ms', () => {
    const t = makeJwt({ userId: 'u1', exp: NOW_SEC + 3600 });
    expect(decodeJwtExpMs(t)).toBe((NOW_SEC + 3600) * 1000);
  });

  it('jti/extra claim varken de exp okunur', () => {
    const t = makeJwt({ userId: 'u1', jti: 'abc', exp: NOW_SEC + 10 });
    expect(decodeJwtExpMs(t)).toBe((NOW_SEC + 10) * 1000);
  });

  it('null/boş/format bozuk → null', () => {
    expect(decodeJwtExpMs(null)).toBeNull();
    expect(decodeJwtExpMs(undefined)).toBeNull();
    expect(decodeJwtExpMs('')).toBeNull();
    expect(decodeJwtExpMs('sadece-tek-parca')).toBeNull();
  });

  it('exp claim yok → null', () => {
    const t = makeJwt({ userId: 'u1' });
    expect(decodeJwtExpMs(t)).toBeNull();
  });

  it('exp sayı değil → null', () => {
    const t = makeJwt({ exp: 'yarin' });
    expect(decodeJwtExpMs(t)).toBeNull();
  });

  it('payload geçersiz base64/JSON → null (throw etmez)', () => {
    expect(decodeJwtExpMs('aaa.@@@notjson@@@.bbb')).toBeNull();
  });
});

describe('msUntilExpiry', () => {
  it('gelecekteki exp → pozitif ms', () => {
    const t = makeJwt({ exp: NOW_SEC + 60 });
    expect(msUntilExpiry(t, NOW)).toBe(60_000);
  });
  it('geçmiş exp → negatif ms', () => {
    const t = makeJwt({ exp: NOW_SEC - 60 });
    expect(msUntilExpiry(t, NOW)).toBe(-60_000);
  });
  it('exp yok → null', () => {
    expect(msUntilExpiry(makeJwt({}), NOW)).toBeNull();
  });
});

describe('shouldAutoLogout', () => {
  it('ayar kapalı → asla logout (süresi geçse bile)', () => {
    const t = makeJwt({ exp: NOW_SEC - 100 });
    expect(shouldAutoLogout(t, NOW, false)).toBe(false);
  });
  it('ayar açık + süresi geçmiş → logout', () => {
    const t = makeJwt({ exp: NOW_SEC - 1 });
    expect(shouldAutoLogout(t, NOW, true)).toBe(true);
  });
  it('ayar açık + tam sınır (now == exp) → logout', () => {
    const t = makeJwt({ exp: NOW_SEC });
    expect(shouldAutoLogout(t, NOW, true)).toBe(true);
  });
  it('ayar açık + hâlâ geçerli → logout etme', () => {
    const t = makeJwt({ exp: NOW_SEC + 3600 });
    expect(shouldAutoLogout(t, NOW, true)).toBe(false);
  });
  it('ayar açık + exp yok → logout etme (belirsiz)', () => {
    expect(shouldAutoLogout(makeJwt({}), NOW, true)).toBe(false);
  });
});
