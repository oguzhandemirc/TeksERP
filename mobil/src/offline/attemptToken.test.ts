// Deneme token'ı durum makinesi — panel ikiziyle AYNI durum tablosu (Electron/src/lib/attemptToken.test.ts).
import { createAttemptToken } from './attemptToken';

const sayac = () => {
  let n = 0;
  return () => `t${++n}`;
};

describe('createAttemptToken', () => {
  it('aynı deneme boyunca token aynı kalır (her basışta üretilmez)', () => {
    const a = createAttemptToken(sayac());
    expect(a.token()).toBe('t1');
    expect(a.token()).toBe('t1');
  });

  it('belirsiz hata (ağ · zaman aşımı · 5xx) → token yapışır', () => {
    const a = createAttemptToken(sayac());
    const t = a.token();
    for (const e of [new Error('Network Error'), { code: 'ECONNABORTED' }, { status: 502 }, { status: 500 }, null]) {
      a.onFailure(e);
      expect(a.token()).toBe(t);
    }
  });

  it('kesin 4xx → yeni deneme; başarı → yeni deneme; renew → yeni deneme', () => {
    const a = createAttemptToken(sayac());
    a.token();
    a.onFailure({ status: 409 });
    expect(a.token()).toBe('t2');
    a.onSuccess();
    expect(a.token()).toBe('t3');
    a.renew();
    expect(a.token()).toBe('t4');
  });

  it('alt kayıt token\'ı anahtar başına tekil, denemeyle birlikte yenilenir', () => {
    const a = createAttemptToken(sayac());
    const x = a.keyed('rulo-1');
    expect(a.keyed('rulo-1')).toBe(x);
    expect(a.keyed('rulo-2')).not.toBe(x);
    a.onFailure({ status: 503 });
    expect(a.keyed('rulo-1')).toBe(x);
    a.onFailure({ status: 400 });
    expect(a.keyed('rulo-1')).not.toBe(x);
  });
});
