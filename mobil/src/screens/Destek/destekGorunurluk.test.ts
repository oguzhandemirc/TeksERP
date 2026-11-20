import {
  safeStatus,
  okunmamisGuvenli,
  rozetMetni,
  nextPage,
  SIFIR_OKUNMAMIS,
  yetkisizMi,
} from './destekGorunurluk';

const err = (status?: number) => Object.assign(new Error('x'), { status });

describe('görünürlük — fail-closed', () => {
  // ⭐ NEGATİF SONDA (2026-11-16, ölçüldü): `safeStatus`tan `etkin &&` koşulu silindi →
  // "etkin:false … Firmanın kapalı" ❌1; geri konunca 9/9 yeşil.
  const KAPALI = { etkin: false, firmaYoneticisi: false };

  it('etkin:true → görünür; firma yöneticisi kararı sunucudan aynen', async () => {
    expect(await safeStatus(async () => ({ etkin: true }))).toEqual({ etkin: true, firmaYoneticisi: false });
    expect(await safeStatus(async () => ({ etkin: true, firmaYoneticisi: true }))).toEqual({
      etkin: true,
      firmaYoneticisi: true,
    });
  });

  it('etkin:false → görünmez; firmaYoneticisi:true gelse de "Firmanın" kapalı', async () => {
    expect(await safeStatus(async () => ({ etkin: false }))).toEqual(KAPALI);
    expect(await safeStatus(async () => ({ etkin: false, firmaYoneticisi: true }))).toEqual(KAPALI);
  });

  it('eski backend (404), ağ hatası, 500 → görünmez, hata dışarı sızmaz', async () => {
    for (const e of [err(404), err(undefined), err(500)]) {
      await expect(safeStatus(() => Promise.reject(e))).resolves.toEqual(KAPALI);
    }
  });
});

describe('rozet yoklaması — hata SESSİZ yutulur', () => {
  it('başarıda yeni değer', async () => {
    expect(await okunmamisGuvenli(async () => ({ count: 3, tickets: 2 }), undefined)).toEqual({ count: 3, tickets: 2 });
  });

  it('502/504/429/ağ hatasında ESKİ değer kalır, reddetmez', async () => {
    const onceki = { count: 1, tickets: 1 };
    for (const e of [err(502), err(504), err(429), err(undefined)]) {
      await expect(okunmamisGuvenli(() => Promise.reject(e), onceki)).resolves.toBe(onceki);
    }
  });

  it('önceki değer yoksa sıfır (rozet görünmez)', async () => {
    await expect(okunmamisGuvenli(() => Promise.reject(err(502)), undefined)).resolves.toEqual(SIFIR_OKUNMAMIS);
    expect(rozetMetni(SIFIR_OKUNMAMIS)).toBeNull();
  });

  it('rozet talep sayısını gösterir, 9 üstü kısalır', () => {
    expect(rozetMetni({ count: 5, tickets: 2 })).toBe('2');
    expect(rozetMetni({ count: 40, tickets: 12 })).toBe('9+');
    expect(rozetMetni(undefined)).toBeNull();
  });
});

describe('liste yardımcıları', () => {
  it('sonraki sayfa total/limit ile bulunur', () => {
    expect(nextPage({ page: 1, limit: 20, total: 45, items: [1] })).toBe(2);
    expect(nextPage({ page: 3, limit: 20, total: 45, items: [1] })).toBeUndefined();
    expect(nextPage({ page: 1, limit: 20, total: 45, items: [] })).toBeUndefined();
  });

  it('yalnız 403 "Firmanın" sekmesini gizler', () => {
    expect(yetkisizMi(err(403))).toBe(true);
    expect(yetkisizMi(err(502))).toBe(false);
  });
});
