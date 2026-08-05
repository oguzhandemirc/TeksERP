import { queryProblem, emptyOrProblemText, QUERY_PROBLEM_TEXT } from './queryState';

// =============================================================================
// 2026-08-05 saha vakasının bekçisi: tablet Wi-Fi'siz kalınca Sipariş listesi
// "Henüz sipariş yok" gösterdi — DB'de 75 sipariş vardı.
//
// Kritik olan 2. test: React Query çevrimdışıyken sorguyu DURAKLATIR, hata
// VERMEZ (`isError:false, isPaused:true`). Yalnız `isError`e bakan ekran bu
// durumu "boş liste" sanar. Bu dosya o ayrımı kilitler.
// =============================================================================

describe('queryProblem', () => {
  it('sorun yoksa null döner (gerçekten boş ya da dolu liste)', () => {
    expect(queryProblem({ isError: false, isPaused: false })).toBeNull();
  });

  it('ÇEVRİMDIŞI (isPaused) sorun sayılır — isError false olsa bile', () => {
    // Kusurun ta kendisi: isError'a bakan kod burada null dönerdi.
    expect(queryProblem({ isError: false, isPaused: true })).toBe('offline');
  });

  it('istek düştüyse (isError) sorun sayılır', () => {
    expect(queryProblem({ isError: true, isPaused: false })).toBe('error');
  });

  it('ikisi birdense çevrimdışı önceliklidir — sebebi o, hata sonucu', () => {
    expect(queryProblem({ isError: true, isPaused: true })).toBe('offline');
  });
});

describe('emptyOrProblemText', () => {
  it('sorun yokken çağıranın normal boş metnini korur', () => {
    expect(emptyOrProblemText({ isError: false, isPaused: false }, 'Müşteri bulunamadı')).toBe(
      'Müşteri bulunamadı',
    );
  });

  it('çevrimdışında normal metni EZER — "bulunamadı" yalanını söylemez', () => {
    const out = emptyOrProblemText({ isError: false, isPaused: true }, 'Müşteri bulunamadı');
    expect(out).toBe(QUERY_PROBLEM_TEXT.offline);
    expect(out).not.toContain('bulunamadı');
  });

  it('hata durumunda da normal metni ezer', () => {
    expect(emptyOrProblemText({ isError: true, isPaused: false }, 'Kumaş bulunamadı')).toBe(
      QUERY_PROBLEM_TEXT.error,
    );
  });

  it('her iki mesaj da sebebi VE çareyi söyler', () => {
    for (const text of Object.values(QUERY_PROBLEM_TEXT)) {
      expect(text.length).toBeGreaterThan(20);
      expect(text).toMatch(/yenile/i); // çare: kullanıcı ne yapacak
    }
  });
});
